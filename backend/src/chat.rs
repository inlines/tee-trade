use crate::{
    ApiError, AppState,
    admin::{hash_token, no_store},
    internal,
};
use axum::{
    Json, Router,
    extract::{
        DefaultBodyLimit, Path, Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode, header},
    middleware,
    response::Response,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Clone, Serialize, Deserialize, sqlx::FromRow)]
struct ChatMessage {
    id: i64,
    chat_id: i64,
    is_admin: bool,
    client_id: String,
    body: String,
    created_at: String,
}
#[derive(Clone)]
pub struct Event {
    customer_id: i64,
    chat_id: i64,
    payload: serde_json::Value,
}
#[derive(Serialize, sqlx::FromRow)]
pub(crate) struct Chat {
    id: i64,
    product_id: i32,
    product_name: String,
    username: String,
    updated_at: String,
    last_message: Option<String>,
    last_message_at: Option<String>,
    product_exists: bool,
    unread_count: i64,
}
pub(crate) struct Actor {
    pub(crate) customer_id: Option<i64>,
    pub(crate) is_admin: bool,
    hash: String,
    pub(crate) csrf: String,
}
const CHAT_SELECT: &str = "SELECT (SELECT COUNT(*) FROM chat_messages WHERE chat_id=c.id AND __UNREAD__) unread_count, c.id, c.product_id, c.product_name, u.username, c.updated_at::text, (SELECT body FROM chat_messages WHERE chat_id=c.id ORDER BY id DESC LIMIT 1) last_message, (SELECT created_at::text FROM chat_messages WHERE chat_id=c.id ORDER BY id DESC LIMIT 1) last_message_at, EXISTS(SELECT 1 FROM products WHERE id=c.product_id) product_exists FROM chats c JOIN customers u ON u.id=c.customer_id";
const MESSAGE_COLUMNS: &str = "id, chat_id, is_admin, client_id, body, created_at::text";

pub(crate) fn chat_select(admin: bool) -> String {
    CHAT_SELECT.replace(
        "__UNREAD__",
        if admin {
            "NOT is_admin AND id>c.admin_read_id"
        } else {
            "is_admin AND id>c.customer_read_id"
        },
    )
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/auth/chats", get(customer_list).post(create))
        .route("/api/admin/chats", get(admin_list))
        .route("/api/admin/chats/{id}/read", post(admin_read))
        .route("/api/auth/chats/{id}/read", post(customer_read))
        .route("/api/admin/chats/events", get(admin_events))
        .route("/api/auth/chats/events", get(customer_events))
        .route("/api/auth/chats/{id}/messages", get(customer_history))
        .route("/api/admin/chats/{id}/messages", get(admin_history))
        .route("/api/auth/chats/ws", get(customer_ws))
        .route("/api/admin/chats/ws", get(admin_ws))
        .layer(DefaultBodyLimit::max(4096))
        .layer(middleware::from_fn(no_store))
}
pub(crate) async fn actor(
    state: &AppState,
    headers: &HeaderMap,
    is_admin: bool,
) -> Result<Actor, ApiError> {
    crate::admin::check_origin(headers, state)?;
    let prefix = if is_admin {
        "tt_session="
    } else {
        "tt_customer="
    };
    let token = headers
        .get(header::COOKIE)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.split(';').find_map(|c| c.trim().strip_prefix(prefix)))
        .filter(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit()))
        .ok_or((StatusCode::UNAUTHORIZED, "Войдите в аккаунт"))?;
    let hash = hash_token(token);
    let row:Option<(Option<i64>,String)> = if is_admin {
        sqlx::query_as("SELECT NULL::bigint, csrf_token FROM admin_sessions WHERE token_hash=$1 AND expires_at>NOW()").bind(&hash).fetch_optional(&state.db).await
    } else {
        sqlx::query_as("SELECT customer_id, csrf_token FROM customer_sessions WHERE token_hash=$1 AND expires_at>NOW()").bind(&hash).fetch_optional(&state.db).await
    }.map_err(internal)?;
    let (customer_id, csrf) =
        row.ok_or((StatusCode::UNAUTHORIZED, "Сессия истекла. Войдите снова"))?;
    Ok(Actor {
        customer_id,
        is_admin,
        hash,
        csrf,
    })
}
async fn active(state: &AppState, actor: &Actor) -> bool {
    let sql = if actor.is_admin {
        "SELECT EXISTS(SELECT 1 FROM admin_sessions WHERE token_hash=$1 AND expires_at>NOW())"
    } else {
        "SELECT EXISTS(SELECT 1 FROM customer_sessions WHERE token_hash=$1 AND expires_at>NOW())"
    };
    sqlx::query_scalar(sql)
        .bind(&actor.hash)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false)
}
async fn allowed(state: &AppState, actor: &Actor, id: i64) -> Result<(), ApiError> {
    let found: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM chats WHERE id=$1 AND ($2 OR customer_id=$3))",
    )
    .bind(id)
    .bind(actor.is_admin)
    .bind(actor.customer_id)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;
    if found {
        Ok(())
    } else {
        Err((StatusCode::NOT_FOUND, "Чат не найден"))
    }
}
async fn list(
    state: AppState,
    headers: HeaderMap,
    admin: bool,
) -> Result<Json<Vec<Chat>>, ApiError> {
    let actor = actor(&state, &headers, admin).await?;
    let select = chat_select(admin);
    Ok(Json(
        sqlx::query_as(&format!(
            "{select} WHERE ($1 OR c.customer_id=$2) ORDER BY c.updated_at DESC, c.id DESC"
        ))
        .bind(admin)
        .bind(actor.customer_id)
        .fetch_all(&state.db)
        .await
        .map_err(internal)?,
    ))
}
async fn customer_list(
    State(s): State<AppState>,
    h: HeaderMap,
) -> Result<Json<Vec<Chat>>, ApiError> {
    list(s, h, false).await
}
async fn admin_list(State(s): State<AppState>, h: HeaderMap) -> Result<Json<Vec<Chat>>, ApiError> {
    list(s, h, true).await
}
#[derive(Deserialize)]
struct NewChat {
    product_id: i32,
}
async fn create(
    State(s): State<AppState>,
    h: HeaderMap,
    Json(input): Json<NewChat>,
) -> Result<Json<Chat>, ApiError> {
    let actor = actor(&s, &h, false).await?;
    if h.get("x-csrf-token").and_then(|v| v.to_str().ok()) != Some(actor.csrf.as_str()) {
        return Err((StatusCode::FORBIDDEN, "Недействительный CSRF-токен"));
    }
    let mut tx = s.db.begin().await.map_err(internal)?;
    let name: Option<String> =
        sqlx::query_scalar("SELECT name FROM products WHERE id=$1 FOR KEY SHARE")
            .bind(input.product_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(internal)?;
    let name = name.ok_or((StatusCode::NOT_FOUND, "Товар не найден"))?;
    let id:i64=sqlx::query_scalar("INSERT INTO chats (customer_id,product_id,product_name) VALUES ($1,$2,$3) ON CONFLICT (customer_id,product_id) DO UPDATE SET product_name=EXCLUDED.product_name RETURNING id").bind(actor.customer_id).bind(input.product_id).bind(name).fetch_one(&mut *tx).await.map_err(internal)?;
    let select = chat_select(false);
    let chat = sqlx::query_as(&format!("{select} WHERE c.id=$1"))
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    let _ = s.chat_updates.send(actor.customer_id.unwrap());
    Ok(Json(chat))
}
#[derive(Deserialize)]
struct HistoryQuery {
    before: Option<i64>,
}
#[derive(Serialize)]
struct History {
    messages: Vec<ChatMessage>,
    has_more: bool,
}
async fn history(state: &AppState, id: i64, before: Option<i64>) -> Result<History, ApiError> {
    let mut messages:Vec<ChatMessage>=sqlx::query_as(&format!("SELECT {MESSAGE_COLUMNS} FROM chat_messages WHERE chat_id=$1 AND ($2::bigint IS NULL OR id<$2) ORDER BY id DESC LIMIT 101")).bind(id).bind(before).fetch_all(&state.db).await.map_err(internal)?;
    let has_more = messages.len() > 100;
    messages.truncate(100);
    messages.reverse();
    Ok(History { messages, has_more })
}
async fn get_history(
    s: AppState,
    h: HeaderMap,
    id: i64,
    q: HistoryQuery,
    admin: bool,
) -> Result<Json<History>, ApiError> {
    let a = actor(&s, &h, admin).await?;
    allowed(&s, &a, id).await?;
    Ok(Json(history(&s, id, q.before).await?))
}
async fn customer_history(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(id): Path<i64>,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<History>, ApiError> {
    get_history(s, h, id, q, false).await
}
async fn admin_history(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(id): Path<i64>,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<History>, ApiError> {
    get_history(s, h, id, q, true).await
}
#[derive(Deserialize)]
struct WsQuery {
    chat_id: i64,
}
async fn upgrade(
    s: AppState,
    h: HeaderMap,
    q: WsQuery,
    ws: WebSocketUpgrade,
    admin: bool,
) -> Result<Response, ApiError> {
    // WebSockets do not have CORS preflight: require the exact application origin.
    if h.get(header::ORIGIN).and_then(|v| v.to_str().ok()) != Some(s.admin_origin.as_str()) {
        return Err((StatusCode::FORBIDDEN, "Недопустимый источник запроса"));
    }
    let a = actor(&s, &h, admin).await?;
    allowed(&s, &a, q.chat_id).await?;
    Ok(ws
        .max_message_size(20000)
        .max_frame_size(20000)
        .on_upgrade(move |socket| connection(socket, s, a, q.chat_id)))
}
async fn customer_ws(
    State(s): State<AppState>,
    h: HeaderMap,
    Query(q): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    upgrade(s, h, q, ws, false).await
}
async fn admin_ws(
    State(s): State<AppState>,
    h: HeaderMap,
    Query(q): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    upgrade(s, h, q, ws, true).await
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Incoming {
    Message { client_id: String, body: String },
    Typing { active: bool },
}
async fn send(socket: &mut WebSocket, value: serde_json::Value) -> bool {
    socket
        .send(Message::Text(value.to_string().into()))
        .await
        .is_ok()
}
async fn save(
    s: &AppState,
    a: &Actor,
    id: i64,
    client_id: String,
    body: String,
) -> Result<ChatMessage, ApiError> {
    let mut tx = s.db.begin().await.map_err(internal)?;
    // Serialize message ordering within a chat, and make reconnect/retry idempotent.
    sqlx::query("SELECT id FROM chats WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    let message=sqlx::query_as(&format!("INSERT INTO chat_messages (chat_id,is_admin,client_id,body) VALUES ($1,$2,$3,$4) ON CONFLICT (chat_id,is_admin,client_id) DO UPDATE SET client_id=EXCLUDED.client_id RETURNING {MESSAGE_COLUMNS}")).bind(id).bind(a.is_admin).bind(client_id).bind(body).fetch_one(&mut *tx).await.map_err(internal)?;
    sqlx::query("UPDATE chats SET updated_at=NOW() WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(message)
}
async fn connection(mut socket: WebSocket, s: AppState, a: Actor, id: i64) {
    let gauge = s
        .monitoring
        .websockets
        .with_label_values(&["chat", if a.is_admin { "admin" } else { "customer" }]);
    gauge.inc();
    let _connection = crate::monitoring::Inflight(gauge);
    let mut events = s.chat_events.subscribe();
    let Ok(customer_id) = sqlx::query_scalar::<_, i64>("SELECT customer_id FROM chats WHERE id=$1")
        .bind(id)
        .fetch_one(&s.db)
        .await
    else {
        return;
    };
    match history(&s, id, None).await {
        Ok(h) => {
            if !send(
                &mut socket,
                serde_json::json!({"type":"history","messages":h.messages,"has_more":h.has_more}),
            )
            .await
            {
                return;
            }
        }
        Err(_) => {
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
    }
    let mut heartbeat = tokio::time::interval(Duration::from_secs(15));
    let mut last_typing = Instant::now() - Duration::from_secs(1);
    let mut last_message = Instant::now() - Duration::from_secs(1);
    loop {
        tokio::select! {
            _=heartbeat.tick()=>{
                if !active(&s,&a).await {let _=send(&mut socket,serde_json::json!({"type":"unauthorized"})).await;break;}
                if socket.send(Message::Ping(Vec::new().into())).await.is_err(){break;}
            }
            event=events.recv()=>match event {
                Ok(e) if e.chat_id==id=>{if !active(&s,&a).await {break;} if !send(&mut socket,e.payload).await {break;}},
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_))=>{break;},
                Err(_)=>break,
                _=>{}
            },
            received=socket.recv()=>{
                let Some(Ok(frame))=received else {break;};
                match frame {
                    Message::Text(text)=>{
                        if !active(&s,&a).await {let _=send(&mut socket,serde_json::json!({"type":"unauthorized"})).await;break;}
                        match serde_json::from_str::<Incoming>(&text) {
                            Ok(Incoming::Typing{active})=>{if last_typing.elapsed()>=Duration::from_millis(300) || !active {last_typing=Instant::now();let _=s.chat_events.send(Event{customer_id,chat_id:id,payload:serde_json::json!({"type":"typing","is_admin":a.is_admin,"active":active})});}},
                            Ok(Incoming::Message{client_id,body})=>{
                                if client_id.is_empty() || client_id.len()>80 || !client_id.bytes().all(|c|c.is_ascii_alphanumeric() || c==b'-') || body.trim().is_empty() || body.chars().count()>4000 || last_message.elapsed()<Duration::from_millis(150) {
                                    let _=send(&mut socket,serde_json::json!({"type":"error","client_id":client_id,"message":"Сообщение не отправлено: проверьте длину (1–4000 символов) или повторите через секунду."})).await;continue;
                                }
                                last_message=Instant::now();
                                match save(&s,&a,id,client_id.clone(),body.trim().to_owned()).await {
                                    Ok(message)=>{let _=send(&mut socket,serde_json::json!({"type":"message","message":message})).await;let _=s.chat_events.send(Event{customer_id,chat_id:id,payload:serde_json::json!({"type":"message","message":message})});let _=s.chat_events.send(Event{customer_id,chat_id:id,payload:serde_json::json!({"type":"typing","is_admin":a.is_admin,"active":false})});},
                                    Err(_)=>{let _=send(&mut socket,serde_json::json!({"type":"error","client_id":client_id,"message":"Не удалось сохранить сообщение. Попробуйте снова."})).await;}
                                }
                            },
                            Err(_)=>{let _=send(&mut socket,serde_json::json!({"type":"error","message":"Неверный формат сообщения"})).await;}
                        }
                    },
                    Message::Close(_)=>break,
                    _=>{}
                }
            }
        }
    }
    let _ = s.chat_events.send(Event {
        customer_id,
        chat_id: id,
        payload: serde_json::json!({"type":"typing","is_admin":a.is_admin,"active":false}),
    });
    let _ = socket.send(Message::Close(None)).await;
}

#[derive(Deserialize)]
struct EventsQuery {
    after: Option<i64>,
    request_after: Option<i64>,
}
async fn admin_events(
    State(s): State<AppState>,
    h: HeaderMap,
    Query(q): Query<EventsQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    events_upgrade(s, h, q, ws, true).await
}
async fn customer_events(
    State(s): State<AppState>,
    h: HeaderMap,
    Query(q): Query<EventsQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    events_upgrade(s, h, q, ws, false).await
}
async fn events_upgrade(
    s: AppState,
    h: HeaderMap,
    q: EventsQuery,
    ws: WebSocketUpgrade,
    admin: bool,
) -> Result<Response, ApiError> {
    if h.get(header::ORIGIN).and_then(|v| v.to_str().ok()) != Some(s.admin_origin.as_str()) {
        return Err((StatusCode::FORBIDDEN, "Недопустимый источник запроса"));
    }
    let a = actor(&s, &h, admin).await?;
    Ok(ws
        .max_message_size(1024)
        .on_upgrade(move |socket| notifications(socket, s, a, q.after, q.request_after)))
}
async fn notification(
    s: &AppState,
    a: &Actor,
    message: &ChatMessage,
) -> Result<serde_json::Value, ApiError> {
    let select = chat_select(a.is_admin);
    let chat: Chat = sqlx::query_as(&format!(
        "{select} WHERE c.id=$1 AND ($2 OR c.customer_id=$3)"
    ))
    .bind(message.chat_id)
    .bind(a.is_admin)
    .bind(a.customer_id)
    .fetch_one(&s.db)
    .await
    .map_err(internal)?;
    Ok(serde_json::json!({"type":"notification","message":message,"chat":chat}))
}
async fn notifications(
    mut socket: WebSocket,
    s: AppState,
    a: Actor,
    after: Option<i64>,
    request_after: Option<i64>,
) {
    let gauge = s.monitoring.websockets.with_label_values(&[
        "notifications",
        if a.is_admin { "admin" } else { "customer" },
    ]);
    gauge.inc();
    let _connection = crate::monitoring::Inflight(gauge);
    let mut events = s.chat_events.subscribe();
    let mut requests = s.request_events.subscribe();
    let mut updates = s.chat_updates.subscribe();
    let mut request_cursor = request_after;
    if !request_catchup(&mut socket, &s, &a, &mut request_cursor).await {
        return;
    }

    // Initial connection establishes a baseline; reconnect catches messages missed offline.
    let latest: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(id),0) FROM chat_messages WHERE is_admin != $1 AND chat_id IN (SELECT id FROM chats WHERE $1 OR customer_id=$2)")
        .bind(a.is_admin)
        .bind(a.customer_id)
        .fetch_one(&s.db)
        .await
        .unwrap_or(0);
    if let Some(after) = after {
        let messages:Vec<ChatMessage>=sqlx::query_as(&format!("SELECT {MESSAGE_COLUMNS} FROM chat_messages WHERE is_admin != $2 AND id>$1 AND chat_id IN (SELECT id FROM chats WHERE $2 OR customer_id=$3) ORDER BY id DESC LIMIT 100")).bind(after).bind(a.is_admin).bind(a.customer_id).fetch_all(&s.db).await.unwrap_or_default();
        for message in messages.iter().rev() {
            if let Ok(value) = notification(&s, &a, message).await {
                if !send(&mut socket, value).await {
                    return;
                }
            }
        }
    }
    if !send(
        &mut socket,
        serde_json::json!({"type":"ready","cursor":latest}),
    )
    .await
    {
        return;
    }
    let mut heartbeat = tokio::time::interval(Duration::from_secs(15));
    loop {
        tokio::select! {
            event=requests.recv()=>match event {
                Ok(customer) if a.is_admin || a.customer_id==Some(customer)=>{
                    if !active(&s,&a).await || !request_catchup(&mut socket,&s,&a,&mut request_cursor).await {break;}
                },
                Ok(_)=>{}, Err(_)=>break
            },
            event=updates.recv()=>match event {
                Ok(customer) if a.is_admin || a.customer_id==Some(customer)=>{
                    if !active(&s,&a).await || !send(&mut socket,serde_json::json!({"type":"chats_changed"})).await {break;}
                },
                Ok(_)=>{}, Err(_)=>break
            },

            _=heartbeat.tick()=>{
                if !active(&s,&a).await {let _=send(&mut socket,serde_json::json!({"type":"unauthorized"})).await;break;}
                if socket.send(Message::Ping(Vec::new().into())).await.is_err(){break;}
            }
            event=events.recv()=>match event {
                Ok(event)=>{
                    if !a.is_admin && a.customer_id != Some(event.customer_id) {continue;}
                    if event.payload.get("type").and_then(|v|v.as_str())!=Some("message"){continue;}
                    if !active(&s,&a).await{break;}
                    if let Some(value)=event.payload.get("message") {
                        if let Ok(message)=serde_json::from_value::<ChatMessage>(value.clone()){
                            if message.is_admin != a.is_admin {if let Ok(payload)=notification(&s,&a,&message).await {if !send(&mut socket,payload).await {break;}}} else if !send(&mut socket,serde_json::json!({"type":"chats_changed"})).await {break;}
                        }
                    }
                }
                Err(_)=>break
            },
            message=socket.recv()=>match message {Some(Ok(Message::Close(_)))|None|Some(Err(_))=>break,_=>{}}
        }
    }
    let _ = socket.send(Message::Close(None)).await;
}

#[derive(Deserialize)]
struct ReadInput {
    through: i64,
}
async fn customer_read(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<ReadInput>,
) -> Result<StatusCode, ApiError> {
    mark_read(s, h, id, input, false).await
}
async fn admin_read(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<ReadInput>,
) -> Result<StatusCode, ApiError> {
    mark_read(s, h, id, input, true).await
}
async fn mark_read(
    s: AppState,
    h: HeaderMap,
    id: i64,
    input: ReadInput,
    admin: bool,
) -> Result<StatusCode, ApiError> {
    let a = actor(&s, &h, admin).await?;
    if h.get("x-csrf-token").and_then(|v| v.to_str().ok()) != Some(a.csrf.as_str()) {
        return Err((StatusCode::FORBIDDEN, "Недействительный CSRF-токен"));
    }
    allowed(&s, &a, id).await?;
    let column = if admin {
        "admin_read_id"
    } else {
        "customer_read_id"
    };
    // Only acknowledge messages actually delivered to this side, never future IDs.
    sqlx::query(&format!("UPDATE chats SET {column}=GREATEST({column},COALESCE((SELECT MAX(id) FROM chat_messages WHERE chat_id=$1 AND id<=$2 AND is_admin!=$3),0)) WHERE id=$1"))
        .bind(id).bind(input.through).bind(admin).execute(&s.db).await.map_err(internal)?;
    let customer: i64 = sqlx::query_scalar("SELECT customer_id FROM chats WHERE id=$1")
        .bind(id)
        .fetch_one(&s.db)
        .await
        .map_err(internal)?;
    let _ = s.chat_updates.send(customer);
    Ok(StatusCode::NO_CONTENT)
}

async fn request_catchup(
    socket: &mut WebSocket,
    s: &AppState,
    a: &Actor,
    cursor: &mut Option<i64>,
) -> bool {
    loop {
        let Ok(batch) = crate::requests::events_for_actor(s, a, *cursor).await else {
            return false;
        };
        let more = batch.events.len() == 100;
        *cursor = Some(batch.cursor);
        if !send(socket,serde_json::json!({"type":"request_events","cursor":batch.cursor,"events":batch.events})).await {return false;}
        if !more {
            return true;
        }
    }
}
