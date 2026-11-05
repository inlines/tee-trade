//! Stable media URLs; files are published atomically before metadata commits.
use crate::{ApiError, internal};
use axum::http::StatusCode;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::path::PathBuf;
use tokio::io::AsyncWriteExt;

type Error = Box<dyn std::error::Error + Send + Sync>;
fn root() -> PathBuf {
    std::env::var_os("MEDIA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/data/media"))
}
fn valid(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit())
}
fn path(id: &str, preview: bool) -> PathBuf {
    root().join(format!("{id}{}.jpg", if preview { ".preview" } else { "" }))
}
fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
pub async fn initialize() -> Result<(), Error> {
    tokio::fs::create_dir_all(root()).await?;
    let probe = root().join(format!(".probe-{}", crate::admin::token()));
    tokio::fs::write(&probe, b"ok").await?;
    tokio::fs::remove_file(probe).await?;
    Ok(())
}
async fn write(id: &str, preview: bool, bytes: &[u8]) -> Result<(), Error> {
    if !valid(id) {
        return Err("Invalid media ID".into());
    }
    let target = path(id, preview);
    let tmp = root().join(format!(".tmp-{}", crate::admin::token()));
    let result = async {
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .await?;
        file.write_all(bytes).await?;
        file.sync_all().await?;
        drop(file);
        tokio::fs::rename(&tmp, &target).await?;
        tokio::fs::File::open(root()).await?.sync_all().await?;
        Ok::<_, Error>(())
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(tmp).await;
    }
    result
}
async fn remove(id: &str) -> Result<(), Error> {
    if !valid(id) {
        return Err("Invalid media ID".into());
    }
    for preview in [false, true] {
        match tokio::fs::remove_file(path(id, preview)).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    tokio::fs::File::open(root()).await?.sync_all().await?;
    Ok(())
}
pub async fn upload(db: &PgPool, id: &str, jpeg: &[u8], preview: &[u8]) -> Result<(), ApiError> {
    let result=async {
        write(id,false,jpeg).await?;write(id,true,preview).await?;
        sqlx::query("INSERT INTO media(id,content_sha256,preview_sha256,content_size,preview_size) VALUES($1,$2,$3,$4,$5)")
            .bind(id).bind(digest(jpeg)).bind(digest(preview)).bind(jpeg.len() as i64).bind(preview.len() as i64).execute(db).await?;
        Ok::<_,Error>(())
    }.await;
    if result.is_err() {
        if let Err(e) = remove(id).await {
            tracing::error!(%id,%e,"failed upload cleanup");
        }
    }
    result.map_err(internal)
}
#[derive(sqlx::FromRow)]
struct Legacy {
    content: Option<Vec<u8>>,
    preview: Option<Vec<u8>>,
    content_sha256: Option<String>,
    preview_sha256: Option<String>,
}
async fn checked(id: &str, preview: bool, expected: Option<&str>) -> Result<Vec<u8>, Error> {
    let expected = expected.ok_or("Missing checksum; run media-export first")?;
    let bytes = tokio::fs::read(path(id, preview)).await?;
    if digest(&bytes) != expected {
        return Err(format!("Checksum mismatch for {id} (preview={preview})").into());
    }
    Ok(bytes)
}
// Row locking serializes export with deletion; no bytes are cleared by export.
async fn process(db: &PgPool, id: &str, mode: &str) -> Result<bool, Error> {
    if !valid(id) {
        return Err("Invalid media ID".into());
    }
    let mut tx = db.begin().await?;
    let row: Option<Legacy> = sqlx::query_as(
        "SELECT content,preview,content_sha256,preview_sha256 FROM media WHERE id=$1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else { return Ok(false) };
    if mode == "media-export" {
        let original = match row.content {
            Some(bytes) => bytes,
            None => checked(id, false, row.content_sha256.as_deref()).await?,
        };
        let preview = match row.preview {
            Some(bytes) => bytes,
            None if row.preview_sha256.is_some() => {
                checked(id, true, row.preview_sha256.as_deref()).await?
            }
            None => {
                let original = original.clone();
                tokio::task::spawn_blocking(move || -> Result<Vec<u8>, Error> {
                    let decoded = image::load_from_memory(&original)?;
                    crate::admin::encode_preview(&decoded)
                        .map_err(|_| "Cannot encode preview".into())
                })
                .await??
            }
        };
        // Re-export repairs missing/corrupt files while legacy bytes still exist.
        if checked(id, false, Some(&digest(&original))).await.is_err() {
            write(id, false, &original).await?;
        }
        if checked(id, true, Some(&digest(&preview))).await.is_err() {
            write(id, true, &preview).await?;
        }
        sqlx::query("UPDATE media SET content_sha256=$2,preview_sha256=$3,content_size=$4,preview_size=$5,preview=CASE WHEN content IS NOT NULL THEN COALESCE(preview,$6) ELSE preview END WHERE id=$1")
            .bind(id).bind(digest(&original)).bind(digest(&preview)).bind(original.len() as i64).bind(preview.len() as i64).bind(&preview).execute(&mut *tx).await?;
    } else {
        let original = checked(id, false, row.content_sha256.as_deref()).await?;
        let preview = checked(id, true, row.preview_sha256.as_deref()).await?;
        if row
            .content
            .as_ref()
            .is_some_and(|b| digest(b) != digest(&original))
            || row
                .preview
                .as_ref()
                .is_some_and(|b| digest(b) != digest(&preview))
        {
            return Err("File differs from database bytes".into());
        }
        if mode == "media-prune-db" {
            sqlx::query("UPDATE media SET content=NULL,preview=NULL WHERE id=$1")
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
    }
    tx.commit().await?;
    Ok(true)
}
pub async fn read(db: &PgPool, id: &str, preview: bool) -> Result<Vec<u8>, ApiError> {
    if !valid(id) {
        return Err((StatusCode::NOT_FOUND, "Фото не найдено"));
    }
    // Backend port also remains functional; Nginx serves existing files directly.
    if let Ok(bytes) = tokio::fs::read(path(id, preview)).await {
        return Ok(bytes);
    }
    if !process(db, id, "media-export").await.map_err(internal)? {
        return Err((StatusCode::NOT_FOUND, "Фото не найдено"));
    }
    tokio::fs::read(path(id, preview)).await.map_err(internal)
}
pub async fn cleanup(db: &PgPool) -> Result<(), Error> {
    let mut tx = db.begin().await?;
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM media_file_deletions ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED",
    )
    .fetch_all(&mut *tx)
    .await?;
    for id in ids {
        remove(&id).await?;
        sqlx::query("DELETE FROM media_file_deletions WHERE id=$1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}
pub async fn run(db: &PgPool, mode: &str, only: Option<&str>) -> Result<(), Error> {
    if !["media-export", "media-verify", "media-prune-db"].contains(&mode) {
        return Err("Unknown media command".into());
    }
    if let Some(id) = only {
        if !process(db, id, mode).await? {
            return Err("Media not found".into());
        }
        println!("{mode}: verified {id} (original + preview)");
        return Ok(());
    }
    let mut after = String::new();
    let mut count = 0;
    loop {
        let ids: Vec<String> =
            sqlx::query_scalar("SELECT id FROM media WHERE id>$1 ORDER BY id LIMIT 100")
                .bind(&after)
                .fetch_all(db)
                .await?;
        if ids.is_empty() {
            break;
        }
        for id in ids {
            if process(db, &id, mode).await? {
                count += 1;
            }
            after = id;
        }
    }
    let missing:i64=sqlx::query_scalar("SELECT count(*) FROM products p CROSS JOIN LATERAL jsonb_array_elements(p.images) i LEFT JOIN media m ON i->>'url'='/api/media/'||m.id WHERE i->>'url' LIKE '/api/media/%' AND m.id IS NULL").fetch_one(db).await?;
    if missing > 0 {
        return Err(format!("{missing} product image references have no media metadata").into());
    }
    cleanup(db).await?;
    println!(
        "{mode}: verified {count} media records (original + preview); product references intact"
    );
    Ok(())
}
