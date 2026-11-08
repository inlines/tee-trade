use crate::{ApiError, AppState, CATEGORIES, PRODUCT_COLUMNS, Product, ProductImage, internal};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, Multipart, Path, Query, Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use image::ImageDecoder;
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::{collections::HashSet, io::Cursor};

fn bad(message: &'static str) -> ApiError {
    (StatusCode::BAD_REQUEST, message)
}
pub(super) fn token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}
pub(super) fn hash_token(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}
fn session_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|cookie| cookie.trim().strip_prefix("tt_session="))
        .filter(|value| value.len() == 64 && value.bytes().all(|c| c.is_ascii_hexdigit()))
}
pub(super) fn check_origin(headers: &HeaderMap, state: &AppState) -> Result<(), ApiError> {
    if let Some(origin) = headers.get(header::ORIGIN) {
        if origin.to_str().ok() != Some(state.admin_origin.as_str()) {
            return Err((StatusCode::FORBIDDEN, "Недопустимый источник запроса"));
        }
    }
    Ok(())
}
fn cookie(state: &AppState, value: &str, age: u32) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "tt_session={value}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age={age}{}",
        if state.secure_cookie { "; Secure" } else { "" }
    ))
    .expect("generated cookie")
}
#[derive(Clone, Serialize, sqlx::FromRow)]
pub struct Session {
    username: String,
    csrf_token: String,
}

pub async fn bootstrap(db: &PgPool) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM admin_account)")
        .fetch_one(db)
        .await?;
    if exists {
        return Ok(());
    }
    let username = std::env::var("ADMIN_USERNAME").unwrap_or_else(|_| "arzamas".into());
    let password = std::env::var("ADMIN_PASSWORD")
        .map_err(|_| "Set ADMIN_PASSWORD for the initial administrator")?;
    if password.len() < 10 {
        return Err("ADMIN_PASSWORD must have at least 10 characters".into());
    }
    let hash = tokio::task::spawn_blocking(move || {
        Argon2::default()
            .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
            .map(|hash| hash.to_string())
            .map_err(|_| "Password hashing failed")
    })
    .await??;
    sqlx::query("INSERT INTO admin_account (username, password_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(username).bind(hash).execute(db).await?;
    Ok(())
}

pub fn routes(state: AppState) -> Router<AppState> {
    let protected = Router::new()
        .route("/api/admin/session", get(session))
        .route("/api/admin/logout", post(logout))
        .route("/api/admin/products", get(list).post(create))
        .route("/api/admin/products/page", get(product_page))
        .route("/api/admin/products/brands", get(brands))
        .route("/api/admin/products/sizes", get(sizes))
        .route("/api/admin/products/labels", get(product_labels))
        .route(
            "/api/admin/products/{id}",
            get(product_detail).put(update).delete(delete_product),
        )
        .route("/api/admin/products/{id}/archive", post(archive_product))
        .route("/api/admin/storefront", get(settings).put(save_settings))
        .route(
            "/api/admin/uploads",
            post(upload).layer(DefaultBodyLimit::max(36 * 1024 * 1024)),
        )
        .route_layer(middleware::from_fn_with_state(state, authorize));
    protected
        .route(
            "/api/admin/login",
            post(login).layer(DefaultBodyLimit::max(4096)),
        )
        .layer(middleware::from_fn(no_store))
}
pub(super) async fn no_store(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}
async fn authorize(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    check_origin(request.headers(), &state)?;
    let token = session_token(request.headers())
        .ok_or((StatusCode::UNAUTHORIZED, "Войдите в аккаунт администратора"))?;
    let session = sqlx::query_as::<_, Session>("SELECT a.username, s.csrf_token FROM admin_sessions s CROSS JOIN admin_account a WHERE s.token_hash = $1 AND s.expires_at > NOW()")
        .bind(hash_token(token)).fetch_optional(&state.db).await.map_err(internal)?
        .ok_or((StatusCode::UNAUTHORIZED, "Сессия истекла. Войдите снова"))?;
    if request.method() != Method::GET && request.method() != Method::HEAD {
        if request
            .headers()
            .get("x-csrf-token")
            .and_then(|v| v.to_str().ok())
            != Some(session.csrf_token.as_str())
        {
            return Err((StatusCode::FORBIDDEN, "Недействительный CSRF-токен"));
        }
    }
    request.extensions_mut().insert(session);
    Ok(next.run(request).await)
}
#[derive(Deserialize)]
struct Credentials {
    username: String,
    password: String,
}
async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(credentials): Json<Credentials>,
) -> Result<Response, ApiError> {
    check_origin(&headers, &state)?;
    if credentials.username.len() > 100 || credentials.password.len() > 512 {
        return Err(bad("Слишком длинный логин или пароль"));
    }
    let attempts: i32 = sqlx::query_scalar("INSERT INTO login_throttle (id, attempts, window_start) VALUES (TRUE, 1, NOW()) ON CONFLICT (id) DO UPDATE SET attempts = CASE WHEN login_throttle.window_start < NOW() - INTERVAL '5 minutes' THEN 1 ELSE login_throttle.attempts + 1 END, window_start = CASE WHEN login_throttle.window_start < NOW() - INTERVAL '5 minutes' THEN NOW() ELSE login_throttle.window_start END RETURNING attempts")
        .fetch_one(&state.db).await.map_err(internal)?;
    if attempts > 15 {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "Слишком много попыток. Попробуйте через 5 минут",
        ));
    }
    let (username, hash): (String, String) =
        sqlx::query_as("SELECT username, password_hash FROM admin_account")
            .fetch_one(&state.db)
            .await
            .map_err(internal)?;
    let matches_username = username == credentials.username;
    let valid = tokio::task::spawn_blocking(move || {
        PasswordHash::new(&hash).is_ok_and(|hash| {
            Argon2::default()
                .verify_password(credentials.password.as_bytes(), &hash)
                .is_ok()
        })
    })
    .await
    .map_err(internal)?;
    if !valid || !matches_username {
        return Err((StatusCode::UNAUTHORIZED, "Неверный логин или пароль"));
    }
    let value = token();
    let session = Session {
        username,
        csrf_token: token(),
    };
    let mut tx = state.db.begin().await.map_err(internal)?;
    if let Some(previous) = session_token(&headers) {
        sqlx::query("DELETE FROM admin_sessions WHERE token_hash = $1")
            .bind(hash_token(previous))
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
    }
    sqlx::query("DELETE FROM admin_sessions WHERE expires_at <= NOW()")
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    sqlx::query("INSERT INTO admin_sessions VALUES ($1, $2, NOW() + INTERVAL '8 hours')")
        .bind(hash_token(&value))
        .bind(&session.csrf_token)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    sqlx::query("DELETE FROM login_throttle")
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok((
        [(header::SET_COOKIE, cookie(&state, &value, 28800))],
        Json(session),
    )
        .into_response())
}
async fn session(Extension(session): Extension<Session>) -> Json<Session> {
    Json(session)
}
async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Result<Response, ApiError> {
    if let Some(token) = session_token(&headers) {
        sqlx::query("DELETE FROM admin_sessions WHERE token_hash = $1")
            .bind(hash_token(token))
            .execute(&state.db)
            .await
            .map_err(internal)?;
    }
    Ok((
        [(header::SET_COOKIE, cookie(&state, "", 0))],
        StatusCode::NO_CONTENT,
    )
        .into_response())
}
async fn list(State(state): State<AppState>) -> Result<Json<Vec<Product>>, ApiError> {
    Ok(Json(
        sqlx::query_as::<_, Product>(&format!(
            "SELECT {PRODUCT_COLUMNS} FROM products ORDER BY id DESC"
        ))
        .fetch_all(&state.db)
        .await
        .map_err(internal)?,
    ))
}
#[derive(Deserialize)]
struct ProductPageQuery {
    limit: i64,
    #[serde(default)]
    offset: i64,
    #[serde(default)]
    sold: bool,
    #[serde(default)]
    search: String,
    #[serde(default)]
    incomplete: bool,
}
#[derive(Serialize)]
struct AdminProductPage {
    items: Vec<Product>,
    total: i64,
}
async fn product_page(
    State(s): State<AppState>,
    Query(q): Query<ProductPageQuery>,
) -> Result<Json<AdminProductPage>, ApiError> {
    if ![4, 8].contains(&q.limit)
        || q.offset < 0
        || q.offset > 1_000_000
        || q.search.chars().count() > 160
    {
        return Err(bad("Invalid pagination"));
    }
    let mut tx = s.db.begin().await.map_err(internal)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    let filter = "sold=$1 AND strpos(lower(name || ' ' || array_to_string(brands, ' ')),lower($2))>0";
    let filter = if q.incomplete {
        format!("{filter} AND (btrim(name)='' OR btrim(category)='' OR cardinality(brands)=0 OR cardinality(sizes)=0 OR btrim(description)='' OR btrim(theme)='' OR price_cents IS NULL OR jsonb_array_length(images)=0)")
    } else { filter.to_owned() };
    let total = sqlx::query_scalar(&format!("SELECT count(*) FROM products WHERE {filter}"))
        .bind(q.sold)
        .bind(q.search.trim())
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    let items = sqlx::query_as(&format!(
        "SELECT {PRODUCT_COLUMNS} FROM products WHERE {filter} ORDER BY id DESC LIMIT $3 OFFSET $4"
    ))
    .bind(q.sold)
    .bind(q.search.trim())
    .bind(q.limit)
    .bind(q.offset)
    .fetch_all(&mut *tx)
    .await
    .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(Json(AdminProductPage { items, total }))
}
async fn product_detail(
    State(s): State<AppState>,
    Path(id): Path<i32>,
) -> Result<Json<Product>, ApiError> {
    sqlx::query_as(&format!(
        "SELECT {PRODUCT_COLUMNS} FROM products WHERE id=$1"
    ))
    .bind(id)
    .fetch_optional(&s.db)
    .await
    .map_err(internal)?
    .map(Json)
    .ok_or((StatusCode::NOT_FOUND, "Товар не найден"))
}
async fn brands(State(s): State<AppState>) -> Result<Json<Vec<String>>, ApiError> {
    Ok(Json(sqlx::query_scalar("SELECT min(btrim(brand)) FROM products CROSS JOIN LATERAL unnest(brands) AS brand WHERE btrim(brand)<>'' GROUP BY lower(btrim(brand)) ORDER BY lower(btrim(brand))").fetch_all(&s.db).await.map_err(internal)?))
}
async fn sizes(State(s): State<AppState>) -> Result<Json<Vec<String>>, ApiError> {
    Ok(Json(sqlx::query_scalar("SELECT min(btrim(size)) FROM products CROSS JOIN LATERAL unnest(sizes) AS size WHERE btrim(size)<>'' GROUP BY lower(btrim(size)) ORDER BY lower(btrim(size))").fetch_all(&s.db).await.map_err(internal)?))
}
#[derive(Deserialize)]
struct LabelQuery {
    ids: String,
}
#[derive(Serialize, sqlx::FromRow)]
struct ProductLabel {
    id: i32,
    name: String,
}
async fn product_labels(
    State(s): State<AppState>,
    Query(q): Query<LabelQuery>,
) -> Result<Json<Vec<ProductLabel>>, ApiError> {
    let ids: Vec<i32> = serde_json::from_str(&q.ids).map_err(|_| bad("Invalid IDs"))?;
    if ids.len() > 48 {
        return Err(bad("Too many IDs"));
    }
    Ok(Json(
        sqlx::query_as("SELECT id,name FROM products WHERE id=ANY($1)")
            .bind(ids)
            .fetch_all(&s.db)
            .await
            .map_err(internal)?,
    ))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ProductInput {
    name: String,
    price_cents: Option<i32>,
    category: String,
    brands: Vec<String>,
    sizes: Vec<String>,
    description: String,
    theme: String,
    images: Vec<ProductImage>,
    #[serde(default)]
    is_demo: bool,
    sold: bool,
}
fn normalize_brands(input: &mut ProductInput) {
    let mut seen_sizes = HashSet::new();
    input.sizes = input.sizes.iter().map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty() && seen_sizes.insert(v.to_lowercase())).collect();
    let mut seen = HashSet::new();
    input.brands = input.brands.iter().map(|b| b.trim().to_owned())
        .filter(|b| !b.is_empty() && seen.insert(b.to_lowercase())).collect();
}
fn text_valid(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max
}
async fn validate_product(
    input: &ProductInput,
    existing: Option<&Product>,
    db: &PgPool,
) -> Result<(), ApiError> {
    if input.name.chars().count() > 160
        || input.brands.len() > 50 || input.brands.iter().any(|b| b.trim().is_empty() || b.chars().count() > 100)
        || input.sizes.len() > 50 || input.sizes.iter().any(|s| s.trim().is_empty() || s.chars().count() > 100)
        || input.theme.chars().count() > 160
        || input.description.chars().count() > 10000
    {
        return Err(bad("Превышена допустимая длина поля"));
    }
    if (!input.category.is_empty() && !CATEGORIES.contains(&input.category.as_str()))
        || input.price_cents.is_some_and(|price| price < 0)
    {
        return Err(bad("Проверьте категорию и цену"));
    }
    if input.images.iter().filter(|i| i.carousel).count() > 1 {
        return Err(bad("Выберите одно фото для главной"));
    }
    if input.images.len() > 12 || input.images.iter().filter(|i| i.kind == "front").count() > 1 {
        return Err(bad(
            "Допустимо до 12 фотографий и не более одного основного фото",
        ));
    }
    let mut urls = HashSet::new();
    for image in &input.images {
        if !["front", "detail", "label"].contains(&image.kind.as_str())
            || image.alt.chars().count() > 250
            || !urls.insert(&image.url)
        {
            return Err(bad("Проверьте роли, подписи и уникальность фотографий"));
        }
        if input.is_demo
            && existing
                .is_some_and(|p| p.is_demo && p.images.iter().any(|old| old.url == image.url))
        {
            continue;
        }
        let id = image
            .url
            .strip_prefix("/api/media/")
            .filter(|id| id.len() == 64 && id.bytes().all(|c| c.is_ascii_hexdigit()))
            .ok_or(bad("Загрузите фотографии через форму товара"))?;
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM media WHERE id = $1)")
            .bind(id)
            .fetch_one(db)
            .await
            .map_err(internal)?;
        if !exists {
            return Err(bad("Загруженная фотография не найдена"));
        }
    }
    Ok(())
}
async fn create(
    State(state): State<AppState>,
    Json(mut input): Json<ProductInput>,
) -> Result<(StatusCode, Json<Product>), ApiError> {
    let mut tx = state.db.begin().await.map_err(internal)?;
    sqlx::query("SELECT id FROM catalog_revision FOR UPDATE")
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    normalize_brands(&mut input);
    validate_product(&input, None, &state.db).await?;
    let product = sqlx::query_as::<_, Product>(&format!("INSERT INTO products (name, price_cents, category, brands, sizes, description, theme, images, is_demo, sold) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING {PRODUCT_COLUMNS}"))
        .bind(input.name.trim()).bind(input.price_cents).bind(input.category).bind(&input.brands).bind(&input.sizes).bind(input.description.trim()).bind(input.theme.trim()).bind(sqlx::types::Json(input.images)).bind(input.is_demo).bind(input.sold).fetch_one(&mut *tx).await.map_err(internal)?;
    sqlx::query("UPDATE catalog_revision SET version = version + 1")
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok((StatusCode::CREATED, Json(product)))
}
async fn archive_product(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> Result<Json<Product>, ApiError> {
    let mut tx = state.db.begin().await.map_err(internal)?;
    sqlx::query("SELECT id FROM catalog_revision FOR UPDATE")
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    let product = sqlx::query_as::<_, Product>(&format!(
        "UPDATE products SET sold = TRUE WHERE id = $1 RETURNING {PRODUCT_COLUMNS}"
    ))
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal)?
    .ok_or((StatusCode::NOT_FOUND, "Товар не найден"))?;
    sqlx::query("UPDATE catalog_revision SET version = version + 1")
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(Json(product))
}

async fn delete_product(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> Result<StatusCode, ApiError> {
    let mut tx = state.db.begin().await.map_err(internal)?;
    sqlx::query("SELECT id FROM catalog_revision FOR UPDATE")
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    let sqlx::types::Json(mut settings): sqlx::types::Json<StorefrontSettings> =
        sqlx::query_scalar("SELECT settings FROM storefront FOR UPDATE")
            .fetch_one(&mut *tx)
            .await
            .map_err(internal)?;
    let images: sqlx::types::Json<Vec<ProductImage>> =
        sqlx::query_scalar("DELETE FROM products WHERE id = $1 RETURNING images")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(internal)?
            .ok_or((StatusCode::NOT_FOUND, "Товар не найден"))?;
    let media_ids: Vec<&str> = images
        .iter()
        .filter_map(|image| image.url.strip_prefix("/api/media/"))
        .collect();
    sqlx::query("DELETE FROM media WHERE id = ANY($1) AND NOT EXISTS (SELECT 1 FROM products p CROSS JOIN LATERAL jsonb_array_elements(p.images) image WHERE image->>'url' = '/api/media/' || media.id)")
        .bind(&media_ids).execute(&mut *tx).await.map_err(internal)?;
    settings.carousel_product_ids.retain(|value| *value != id);
    settings.featured_product_ids.retain(|value| *value != id);
    if settings.carousel_product_ids.is_empty() {
        settings.carousel_enabled = false;
    }
    if settings.featured_product_ids.is_empty() {
        settings.popular_enabled = false;
    }
    sqlx::query("UPDATE storefront SET settings = $1")
        .bind(sqlx::types::Json(&settings))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    sqlx::query("UPDATE catalog_revision SET version = version + 1")
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    if let Err(error) = crate::media_store::cleanup(&state.db).await {
        tracing::error!(%error,"media cleanup queued for retry");
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(mut input): Json<ProductInput>,
) -> Result<Json<Product>, ApiError> {
    let mut tx = state.db.begin().await.map_err(internal)?;
    sqlx::query("SELECT id FROM catalog_revision FOR UPDATE")
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    let existing = sqlx::query_as::<_, Product>(&format!(
        "SELECT {PRODUCT_COLUMNS} FROM products WHERE id = $1"
    ))
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?
    .ok_or((StatusCode::NOT_FOUND, "Товар не найден"))?;
    normalize_brands(&mut input);
    validate_product(&input, Some(&existing), &state.db).await?;
    let product = sqlx::query_as::<_, Product>(&format!("UPDATE products SET name=$1, price_cents=$2, category=$3, brands=$4, sizes=$5, description=$6, theme=$7, images=$8, is_demo=$9, sold=$10 WHERE id=$11 RETURNING {PRODUCT_COLUMNS}"))
        .bind(input.name.trim()).bind(input.price_cents).bind(input.category).bind(&input.brands).bind(&input.sizes).bind(input.description.trim()).bind(input.theme.trim()).bind(sqlx::types::Json(input.images)).bind(input.is_demo).bind(input.sold).bind(id).fetch_one(&mut *tx).await.map_err(internal)?;
    sqlx::query("UPDATE catalog_revision SET version = version + 1")
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(Json(product))
}

async fn upload(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    let field = multipart
        .next_field()
        .await
        .map_err(|_| bad("Не удалось прочитать файл"))?
        .ok_or(bad("Выберите фотографию"))?;
    if field.name() != Some("file") {
        return Err(bad("Ожидается поле file"));
    }
    let bytes = field
        .bytes()
        .await
        .map_err(|_| bad("Файл слишком большой или повреждён"))?;
    if bytes.len() > 35 * 1024 * 1024 {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            "Максимальный размер фото — 35 МБ",
        ));
    }
    if multipart
        .next_field()
        .await
        .map_err(|_| bad("Некорректная загрузка"))?
        .is_some()
    {
        return Err(bad("Загружайте по одному файлу"));
    }
    let (jpeg, preview) =
        tokio::task::spawn_blocking(move || -> Result<(Vec<u8>, Vec<u8>), ApiError> {
            let format =
                image::guess_format(&bytes).map_err(|_| bad("Поддерживаются JPEG, PNG и WebP"))?;
            if !matches!(
                format,
                image::ImageFormat::Jpeg | image::ImageFormat::Png | image::ImageFormat::WebP
            ) {
                return Err(bad("Поддерживаются JPEG, PNG и WebP"));
            }
            let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
            let mut limits = image::Limits::default();
            limits.max_image_width = Some(8000);
            limits.max_image_height = Some(8000);
            limits.max_alloc = Some(128 * 1024 * 1024);
            reader.limits(limits);
            let mut decoder = reader
                .into_decoder()
                .map_err(|_| bad("Фото повреждено или превышает допустимое разрешение"))?;
            let orientation = decoder
                .orientation()
                .map_err(|_| bad("Не удалось прочитать ориентацию фото"))?;
            let mut decoded = image::DynamicImage::from_decoder(decoder)
                .map_err(|_| bad("Фото повреждено или превышает допустимое разрешение"))?;
            decoded.apply_orientation(orientation);
            let mut output = Vec::new();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 90)
                .encode_image(&decoded.thumbnail(2400, 2400).to_rgb8())
                .map_err(internal)?;
            let preview = encode_preview(&decoded)?;
            Ok((output, preview))
        })
        .await
        .map_err(internal)??;
    let id = token();
    crate::media_store::upload(&state.db, &id, &jpeg, &preview).await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({"url": format!("/api/media/{id}")})),
    ))
}
pub async fn media(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let bytes = crate::media_store::read(&state.db, &id, false).await?;
    Ok((
        [
            (header::CONTENT_TYPE, "image/jpeg"),
            (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StorefrontSettings {
    carousel_product_ids: Vec<i32>,
    featured_product_ids: Vec<i32>,
    categories: Vec<String>,
    arrivals_title: String,
    arrivals_subtitle: String,
    popular_title: String,
    manifesto_eyebrow: String,
    manifesto_title: String,
    manifesto_link_text: String,
    carousel_enabled: bool,
    categories_enabled: bool,
    popular_enabled: bool,
    manifesto_enabled: bool,
}
async fn settings(State(state): State<AppState>) -> Result<Json<StorefrontSettings>, ApiError> {
    let settings: sqlx::types::Json<StorefrontSettings> =
        sqlx::query_scalar("SELECT settings FROM storefront")
            .fetch_one(&state.db)
            .await
            .map_err(internal)?;
    Ok(Json(settings.0))
}
async fn save_settings(
    State(state): State<AppState>,
    Json(settings): Json<StorefrontSettings>,
) -> Result<Json<StorefrontSettings>, ApiError> {
    if !text_valid(&settings.arrivals_title, 100)
        || !text_valid(&settings.popular_title, 100)
        || !text_valid(&settings.manifesto_title, 500)
        || !text_valid(&settings.manifesto_link_text, 100)
        || settings.arrivals_subtitle.chars().count() > 200
        || settings.manifesto_eyebrow.chars().count() > 200
    {
        return Err(bad("Проверьте заголовки и длину текстов витрины"));
    }
    if settings.categories.len() > CATEGORIES.len()
        || settings.categories.iter().collect::<HashSet<_>>().len() != settings.categories.len()
        || settings
            .categories
            .iter()
            .any(|c| !CATEGORIES.contains(&c.as_str()))
    {
        return Err(bad("Недопустимые категории витрины"));
    }
    let mut tx = state.db.begin().await.map_err(internal)?;
    sqlx::query("SELECT id FROM catalog_revision FOR UPDATE")
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    sqlx::query("SELECT id FROM storefront FOR UPDATE")
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    for ids in [
        &settings.carousel_product_ids,
        &settings.featured_product_ids,
    ] {
        if ids.len() > 24 || ids.iter().collect::<HashSet<_>>().len() != ids.len() {
            return Err(bad("В подборке должно быть не более 24 разных товаров"));
        }
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM products WHERE id = ANY($1)")
            .bind(ids)
            .fetch_one(&mut *tx)
            .await
            .map_err(internal)?;
        if count != ids.len() as i64 {
            return Err(bad("Один из товаров витрины не найден"));
        }
    }
    if (settings.carousel_enabled && settings.carousel_product_ids.is_empty())
        || (settings.popular_enabled && settings.featured_product_ids.is_empty())
        || (settings.categories_enabled && settings.categories.is_empty())
    {
        return Err(bad("Выберите содержимое включённых разделов"));
    }
    sqlx::query("UPDATE storefront SET settings = $1")
        .bind(sqlx::types::Json(&settings))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    sqlx::query("UPDATE catalog_revision SET version = version + 1")
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(Json(settings))
}
#[derive(Serialize, Deserialize)]
pub struct Storefront {
    settings: StorefrontSettings,
    carousel: Vec<Product>,
    featured: Vec<Product>,
}
pub async fn storefront(State(state): State<AppState>) -> Result<Json<Storefront>, ApiError> {
    crate::catalog_cache::get(&state, "storefront", async {
        let Json(settings) = self::settings(State(state.clone())).await?;
        let carousel = selected_products(&state.db, &settings.carousel_product_ids).await?;
        let featured = selected_products(&state.db, &settings.featured_product_ids).await?;
        Ok(Storefront {
            settings,
            carousel,
            featured,
        })
    })
    .await
    .map(Json)
}

async fn selected_products(db: &PgPool, ids: &[i32]) -> Result<Vec<Product>, ApiError> {
    sqlx::query_as::<_, Product>(&format!(
        "SELECT {PRODUCT_COLUMNS} FROM products WHERE id = ANY($1) AND NOT sold ORDER BY array_position($1, id)"
    ))
    .bind(ids)
    .fetch_all(db)
    .await
    .map_err(internal)
}

pub(crate) fn encode_preview(decoded: &image::DynamicImage) -> Result<Vec<u8>, ApiError> {
    let mut output = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 78)
        .encode_image(&decoded.thumbnail(480, 480).to_rgb8())
        .map_err(internal)?;
    Ok(output)
}
pub async fn media_preview(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let bytes = crate::media_store::read(&state.db, &id, true).await?;
    Ok((
        [
            (header::CONTENT_TYPE, "image/jpeg"),
            (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response())
}
