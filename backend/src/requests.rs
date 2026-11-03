use crate::{ApiError, AppState, admin::no_store, chat, internal};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, StatusCode},
    middleware,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
#[derive(Serialize, sqlx::FromRow)]
struct PurchaseRequest {
    id: i64,
    chat_id: i64,
    product_id: i32,
    product_name: String,
    username: String,
    last_name: String,
    first_name: String,
    patronymic: String,
    contact: String,
    city: String,
    status: String,
    created_at: String,
    updated_at: String,
    product_exists: bool,
}
const SELECT: &str = "SELECT r.id,r.chat_id,r.product_id,r.product_name,u.username,r.last_name,r.first_name,r.patronymic,r.contact,r.city,r.status,r.created_at::text,r.updated_at::text,EXISTS(SELECT 1 FROM products WHERE id=r.product_id) product_exists FROM purchase_requests r JOIN customers u ON u.id=r.customer_id";
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/auth/requests", get(customer_list).post(create))
        .route("/api/admin/requests", get(admin_list))
        .route("/api/admin/requests/{id}/status", post(change_status))
        .route("/api/admin/requests/{id}/chat", get(open_chat))
        .route("/api/admin/requests/events", get(admin_events))
        .route("/api/auth/requests/events", get(customer_events))
        .layer(DefaultBodyLimit::max(8192))
        .layer(middleware::from_fn(no_store))
}
fn csrf(h: &HeaderMap, a: &chat::Actor) -> Result<(), ApiError> {
    if h.get("x-csrf-token").and_then(|v| v.to_str().ok()) == Some(a.csrf.as_str()) {
        Ok(())
    } else {
        Err((StatusCode::FORBIDDEN, "Недействительный CSRF-токен"))
    }
}
async fn list(
    s: AppState,
    h: HeaderMap,
    admin: bool,
) -> Result<Json<Vec<PurchaseRequest>>, ApiError> {
    let a = chat::actor(&s, &h, admin).await?;
    Ok(Json(
        sqlx::query_as(&format!(
            "{SELECT} WHERE ($1 OR r.customer_id=$2) ORDER BY r.id DESC"
        ))
        .bind(admin)
        .bind(a.customer_id)
        .fetch_all(&s.db)
        .await
        .map_err(internal)?,
    ))
}
async fn customer_list(
    State(s): State<AppState>,
    h: HeaderMap,
) -> Result<Json<Vec<PurchaseRequest>>, ApiError> {
    list(s, h, false).await
}
async fn admin_list(
    State(s): State<AppState>,
    h: HeaderMap,
) -> Result<Json<Vec<PurchaseRequest>>, ApiError> {
    list(s, h, true).await
}
#[derive(Deserialize)]
struct Draft {
    product_id: i32,
    last_name: String,
    first_name: String,
    #[serde(default)]
    patronymic: String,
    contact: String,
    city: String,
}
async fn create(
    State(s): State<AppState>,
    h: HeaderMap,
    Json(mut d): Json<Draft>,
) -> Result<(StatusCode, Json<PurchaseRequest>), ApiError> {
    let a = chat::actor(&s, &h, false).await?;
    csrf(&h, &a)?;
    for (v, max, required) in [
        (&mut d.last_name, 100, true),
        (&mut d.first_name, 100, true),
        (&mut d.patronymic, 100, false),
        (&mut d.contact, 300, true),
        (&mut d.city, 160, true),
    ] {
        *v = v.trim().to_owned();
        if (required && v.is_empty()) || v.chars().count() > max || v.chars().any(char::is_control)
        {
            return Err((
                StatusCode::BAD_REQUEST,
                "Заполните имя, фамилию, контакт и город. Проверьте длину полей.",
            ));
        }
    }
    let mut tx = s.db.begin().await.map_err(internal)?;
    let name: String = sqlx::query_scalar("SELECT name FROM products WHERE id=$1 FOR KEY SHARE")
        .bind(d.product_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, "Товар не найден"))?;
    let chat_id:i64=sqlx::query_scalar("INSERT INTO chats(customer_id,product_id,product_name) VALUES($1,$2,$3) ON CONFLICT(customer_id,product_id) DO UPDATE SET product_name=EXCLUDED.product_name RETURNING id").bind(a.customer_id).bind(d.product_id).bind(&name).fetch_one(&mut *tx).await.map_err(internal)?;
    let id:Option<i64>=sqlx::query_scalar("INSERT INTO purchase_requests(customer_id,chat_id,product_id,product_name,last_name,first_name,patronymic,contact,city) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(customer_id,product_id) WHERE status <> 'completed' DO NOTHING RETURNING id").bind(a.customer_id).bind(chat_id).bind(d.product_id).bind(name).bind(d.last_name).bind(d.first_name).bind(d.patronymic).bind(d.contact).bind(d.city).fetch_optional(&mut *tx).await.map_err(internal)?;
    let id = id.ok_or((
        StatusCode::CONFLICT,
        "У вас уже есть активная заявка на этот товар. Посмотрите её в профиле.",
    ))?;
    // Serialize event allocation through commit so cursor polling cannot skip a late commit.
    sqlx::query("SELECT pg_advisory_xact_lock(884219032)")
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    sqlx::query(
        "INSERT INTO purchase_request_events(request_id,for_admin,status) VALUES($1,true,'new')",
    )
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(internal)?;
    let row = sqlx::query_as(&format!("{SELECT} WHERE r.id=$1"))
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    let customer: i64 = sqlx::query_scalar("SELECT customer_id FROM purchase_requests WHERE id=$1")
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    let _ = s.request_events.send(customer);
    let _ = s.chat_updates.send(customer);
    Ok((StatusCode::CREATED, Json(row)))
}
#[derive(Deserialize)]
struct StatusUpdate {
    status: String,
}
async fn change_status(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(id): Path<i64>,
    Json(d): Json<StatusUpdate>,
) -> Result<Json<PurchaseRequest>, ApiError> {
    let a = chat::actor(&s, &h, true).await?;
    csrf(&h, &a)?;
    let previous = match d.status.as_str() {
        "in_progress" => "new",
        "completed" => "in_progress",
        _ => return Err((StatusCode::BAD_REQUEST, "Недопустимый статус")),
    };
    let mut tx = s.db.begin().await.map_err(internal)?;
    let changed = sqlx::query(
        "UPDATE purchase_requests SET status=$1,updated_at=now() WHERE id=$2 AND status=$3",
    )
    .bind(&d.status)
    .bind(id)
    .bind(previous)
    .execute(&mut *tx)
    .await
    .map_err(internal)?
    .rows_affected();
    if changed == 0 {
        return Err((
            StatusCode::CONFLICT,
            "Заявка не найдена или её статус уже изменился. Обновите список.",
        ));
    }
    // Serialize event allocation through commit so cursor polling cannot skip a late commit.
    sqlx::query("SELECT pg_advisory_xact_lock(884219032)")
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    sqlx::query(
        "INSERT INTO purchase_request_events(request_id,for_admin,status) VALUES($1,false,$2)",
    )
    .bind(id)
    .bind(&d.status)
    .execute(&mut *tx)
    .await
    .map_err(internal)?;
    let row = sqlx::query_as(&format!("{SELECT} WHERE r.id=$1"))
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    let customer: i64 = sqlx::query_scalar("SELECT customer_id FROM purchase_requests WHERE id=$1")
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    let _ = s.request_events.send(customer);
    let _ = s.chat_updates.send(customer);
    Ok(Json(row))
}
async fn open_chat(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<chat::Chat>, ApiError> {
    chat::actor(&s, &h, true).await?;
    let select = chat::chat_select(true);
    sqlx::query_as(&format!(
        "{select} WHERE c.id=(SELECT chat_id FROM purchase_requests WHERE id=$1)"
    ))
    .bind(id)
    .fetch_optional(&s.db)
    .await
    .map_err(internal)?
    .map(Json)
    .ok_or((StatusCode::NOT_FOUND, "Заявка не найдена"))
}
#[derive(Deserialize)]
struct Cursor {
    after: Option<i64>,
}
#[derive(Serialize, sqlx::FromRow)]
pub(crate) struct Notice {
    id: i64,
    request_id: i64,
    product_name: String,
    status: String,
}
#[derive(Serialize)]
pub(crate) struct Events {
    pub(crate) cursor: i64,
    pub(crate) events: Vec<Notice>,
}
async fn events(
    s: AppState,
    h: HeaderMap,
    q: Cursor,
    admin: bool,
) -> Result<Json<Events>, ApiError> {
    let a = chat::actor(&s, &h, admin).await?;
    events_for_actor(&s, &a, q.after).await.map(Json)
}
pub(crate) async fn events_for_actor(
    s: &AppState,
    a: &chat::Actor,
    after: Option<i64>,
) -> Result<Events, ApiError> {
    let admin = a.is_admin;
    let latest:i64=sqlx::query_scalar("SELECT COALESCE(MAX(e.id),0) FROM purchase_request_events e JOIN purchase_requests r ON r.id=e.request_id WHERE e.for_admin=$1 AND ($1 OR r.customer_id=$2)").bind(admin).bind(a.customer_id).fetch_one(&s.db).await.map_err(internal)?;
    let Some(after) = after else {
        return Ok(Events {
            cursor: latest,
            events: vec![],
        });
    };
    let events:Vec<Notice>=sqlx::query_as("SELECT e.id,e.request_id,r.product_name,e.status FROM purchase_request_events e JOIN purchase_requests r ON r.id=e.request_id WHERE e.for_admin=$1 AND ($1 OR r.customer_id=$2) AND e.id>$3 AND e.id<=$4 ORDER BY e.id LIMIT 100").bind(admin).bind(a.customer_id).bind(after.max(0)).bind(latest).fetch_all(&s.db).await.map_err(internal)?;
    let cursor = events.last().map_or(latest, |e| e.id);
    Ok(Events { cursor, events })
}
async fn admin_events(
    State(s): State<AppState>,
    h: HeaderMap,
    Query(q): Query<Cursor>,
) -> Result<Json<Events>, ApiError> {
    events(s, h, q, true).await
}
async fn customer_events(
    State(s): State<AppState>,
    h: HeaderMap,
    Query(q): Query<Cursor>,
) -> Result<Json<Events>, ApiError> {
    events(s, h, q, false).await
}
