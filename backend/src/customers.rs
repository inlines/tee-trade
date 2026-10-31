use crate::admin::{check_origin, hash_token, no_store, token};
use crate::{ApiError, AppState, internal};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct Credentials {
    username: String,
    password: String,
    #[serde(default)]
    password_confirmation: String,
}
#[derive(Serialize, sqlx::FromRow)]
struct Session {
    username: String,
    csrf_token: String,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/auth/register", post(register))
        .route("/api/auth/login", post(login))
        .route("/api/auth/session", get(session))
        .route("/api/auth/logout", post(logout))
        .layer(DefaultBodyLimit::max(4096))
        .layer(middleware::from_fn(no_store))
}
fn session_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|part| part.trim().strip_prefix("tt_customer="))
        .filter(|value| value.len() == 64 && value.bytes().all(|c| c.is_ascii_hexdigit()))
}
fn cookie(state: &AppState, value: &str, age: u32) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "tt_customer={value}; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age={age}{}",
        if state.secure_cookie { "; Secure" } else { "" }
    ))
    .expect("generated cookie")
}
fn validate(credentials: &Credentials) -> Result<(String, String), ApiError> {
    let username = credentials.username.trim();
    if !(3..=40).contains(&username.chars().count())
        || !username
            .chars()
            .all(|c| c.is_alphanumeric() || "_-.".contains(c))
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "Логин: от 3 до 40 букв, цифр, точек, дефисов или подчёркиваний",
        ));
    }
    if credentials.password.len() > 512 || credentials.password.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Укажите пароль длиной не более 512 байт",
        ));
    }
    Ok((username.to_owned(), username.to_lowercase()))
}
async fn throttle(state: &AppState, key: &str) -> Result<(), ApiError> {
    sqlx::query(
        "DELETE FROM customer_auth_throttle WHERE window_start < NOW() - INTERVAL '5 minutes'",
    )
    .execute(&state.db)
    .await
    .map_err(internal)?;
    for (key, limit) in [("global".to_owned(), 100), (format!("username:{key}"), 15)] {
        let attempts: i32 = sqlx::query_scalar("INSERT INTO customer_auth_throttle (key, attempts, window_start) VALUES ($1, 1, NOW()) ON CONFLICT (key) DO UPDATE SET attempts = customer_auth_throttle.attempts + 1 RETURNING attempts")
            .bind(key).fetch_one(&state.db).await.map_err(internal)?;
        if attempts > limit {
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                "Слишком много попыток. Попробуйте через 5 минут",
            ));
        }
    }
    Ok(())
}
async fn register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(credentials): Json<Credentials>,
) -> Result<Response, ApiError> {
    check_origin(&headers, &state)?;
    let (username, key) = validate(&credentials)?;
    if credentials.password.chars().count() < 8 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Пароль должен содержать минимум 8 символов",
        ));
    }
    if credentials.password != credentials.password_confirmation {
        return Err((StatusCode::BAD_REQUEST, "Пароли не совпадают"));
    }
    throttle(&state, &key).await?;
    let reserved: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM admin_account WHERE lower(username) = $1)")
            .bind(&key)
            .fetch_one(&state.db)
            .await
            .map_err(internal)?;
    if reserved {
        return Err((StatusCode::CONFLICT, "Этот логин уже занят"));
    }
    let password = credentials.password;
    let hash = tokio::task::spawn_blocking(move || {
        Argon2::default()
            .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
            .map(|value| value.to_string())
    })
    .await
    .map_err(internal)?
    .map_err(internal)?;
    let mut tx = state.db.begin().await.map_err(internal)?;
    let id: Option<i64> = sqlx::query_scalar("INSERT INTO customers (username, username_key, password_hash) VALUES ($1,$2,$3) ON CONFLICT (username_key) DO NOTHING RETURNING id")
        .bind(&username).bind(key).bind(hash).fetch_optional(&mut *tx).await.map_err(internal)?;
    let id = id.ok_or((StatusCode::CONFLICT, "Этот логин уже занят"))?;
    let (value, session) = new_session(&mut tx, &headers, id, username).await?;
    tx.commit().await.map_err(internal)?;
    Ok((
        StatusCode::CREATED,
        [(header::SET_COOKIE, cookie(&state, &value, 604800))],
        Json(session),
    )
        .into_response())
}
async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(credentials): Json<Credentials>,
) -> Result<Response, ApiError> {
    check_origin(&headers, &state)?;
    let (_, key) = validate(&credentials)?;
    throttle(&state, &key).await?;
    let account: Option<(i64, String, String)> =
        sqlx::query_as("SELECT id, username, password_hash FROM customers WHERE username_key = $1")
            .bind(key)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;
    // Use an existing Argon2 hash for missing users so verification still performs the same work.
    let hash = match &account {
        Some((_, _, hash)) => hash.clone(),
        None => sqlx::query_scalar("SELECT password_hash FROM admin_account")
            .fetch_one(&state.db)
            .await
            .map_err(internal)?,
    };
    let valid = tokio::task::spawn_blocking(move || {
        PasswordHash::new(&hash).is_ok_and(|hash| {
            Argon2::default()
                .verify_password(credentials.password.as_bytes(), &hash)
                .is_ok()
        })
    })
    .await
    .map_err(internal)?;
    let (id, username, _) = account
        .filter(|_| valid)
        .ok_or((StatusCode::UNAUTHORIZED, "Неверный логин или пароль"))?;
    let mut tx = state.db.begin().await.map_err(internal)?;
    let (value, session) = new_session(&mut tx, &headers, id, username).await?;
    tx.commit().await.map_err(internal)?;
    Ok((
        [(header::SET_COOKIE, cookie(&state, &value, 604800))],
        Json(session),
    )
        .into_response())
}
async fn new_session(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    headers: &HeaderMap,
    id: i64,
    username: String,
) -> Result<(String, Session), ApiError> {
    if let Some(previous) = session_token(headers) {
        sqlx::query("DELETE FROM customer_sessions WHERE token_hash = $1")
            .bind(hash_token(previous))
            .execute(&mut **tx)
            .await
            .map_err(internal)?;
    }
    sqlx::query("DELETE FROM customer_sessions WHERE expires_at <= NOW()")
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    let value = token();
    let session = Session {
        username,
        csrf_token: token(),
    };
    sqlx::query("INSERT INTO customer_sessions (token_hash, customer_id, csrf_token, expires_at) VALUES ($1,$2,$3,NOW() + INTERVAL '7 days')").bind(hash_token(&value)).bind(id).bind(&session.csrf_token).execute(&mut **tx).await.map_err(internal)?;
    Ok((value, session))
}
async fn current(state: &AppState, headers: &HeaderMap) -> Result<Session, ApiError> {
    let token = session_token(headers).ok_or((StatusCode::UNAUTHORIZED, "Войдите в аккаунт"))?;
    sqlx::query_as("SELECT c.username, s.csrf_token FROM customer_sessions s JOIN customers c ON c.id = s.customer_id WHERE s.token_hash = $1 AND s.expires_at > NOW()")
        .bind(hash_token(token)).fetch_optional(&state.db).await.map_err(internal)?.ok_or((StatusCode::UNAUTHORIZED, "Сессия истекла. Войдите снова"))
}
async fn session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Session>, ApiError> {
    Ok(Json(current(&state, &headers).await?))
}
async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Result<Response, ApiError> {
    check_origin(&headers, &state)?;
    let session = current(&state, &headers).await?;
    if headers.get("x-csrf-token").and_then(|h| h.to_str().ok())
        != Some(session.csrf_token.as_str())
    {
        return Err((StatusCode::FORBIDDEN, "Недействительный CSRF-токен"));
    }
    if let Some(value) = session_token(&headers) {
        sqlx::query("DELETE FROM customer_sessions WHERE token_hash = $1")
            .bind(hash_token(value))
            .execute(&state.db)
            .await
            .map_err(internal)?;
    }
    Ok((
        StatusCode::NO_CONTENT,
        [(header::SET_COOKIE, cookie(&state, "", 0))],
    )
        .into_response())
}
