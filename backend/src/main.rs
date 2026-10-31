use axum::{
    Json, Router,
    extract::{Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use prometheus::{Encoder, IntCounterVec, Registry, TextEncoder};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Clone)]
struct AppState {
    db: PgPool,
    cache: redis::Client,
    registry: Registry,
    requests: IntCounterVec,
}
#[derive(Serialize, Deserialize, sqlx::FromRow)]
struct Product {
    id: i32,
    name: String,
    price_cents: i32,
}
type ApiError = (StatusCode, &'static str);
fn internal(error: impl std::fmt::Display) -> ApiError {
    tracing::error!(%error, "request failed");
    (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error")
}
async fn products(State(state): State<AppState>) -> Result<Json<Vec<Product>>, ApiError> {
    let mut cache = state.cache.get_multiplexed_async_connection().await.ok();
    if let Some(connection) = cache.as_mut() {
        if let Ok(Some(value)) = connection.get::<_, Option<String>>("products:v1").await {
            if let Ok(products) = serde_json::from_str(&value) {
                return Ok(Json(products));
            }
        }
    }
    let products =
        sqlx::query_as::<_, Product>("SELECT id, name, price_cents FROM products ORDER BY id")
            .fetch_all(&state.db)
            .await
            .map_err(internal)?;
    if let Some(connection) = cache.as_mut() {
        if let Ok(value) = serde_json::to_string(&products) {
            let _: redis::RedisResult<()> = connection.set_ex("products:v1", value, 60).await;
        }
    }
    Ok(Json(products))
}
async fn ready(State(state): State<AppState>) -> Result<&'static str, ApiError> {
    sqlx::query("SELECT 1")
        .execute(&state.db)
        .await
        .map_err(|_| (StatusCode::SERVICE_UNAVAILABLE, "Database unavailable"))?;
    Ok("ready")
}
async fn metrics(State(state): State<AppState>) -> impl IntoResponse {
    let encoder = TextEncoder::new();
    let mut buffer = Vec::new();
    match encoder.encode(&state.registry.gather(), &mut buffer) {
        Ok(()) => (
            [(
                axum::http::header::CONTENT_TYPE,
                encoder.format_type().to_owned(),
            )],
            buffer,
        )
            .into_response(),
        Err(error) => internal(error).into_response(),
    }
}
async fn count(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let path = request
        .extensions()
        .get::<axum::extract::MatchedPath>()
        .map(|p| p.as_str())
        .unwrap_or("unmatched")
        .to_owned();
    let response = next.run(request).await;
    state
        .requests
        .with_label_values(&[path.as_str(), response.status().as_str()])
        .inc();
    response
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let db = PgPool::connect(&std::env::var("DATABASE_URL")?).await?;
    sqlx::migrate!().run(&db).await?;
    let registry = Registry::new();
    let requests = IntCounterVec::new(
        prometheus::Opts::new("http_requests_total", "HTTP responses"),
        &["route", "status"],
    )?;
    registry.register(Box::new(requests.clone()))?;
    let state = AppState {
        db,
        cache: redis::Client::open(std::env::var("REDIS_URL")?)?,
        registry,
        requests,
    };
    let app = Router::new()
        .route("/api/products", get(products))
        .route("/health", get(|| async { "ok" }))
        .route("/ready", get(ready))
        .route("/metrics", get(metrics))
        .layer(middleware::from_fn_with_state(state.clone(), count))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    tracing::info!("API listening on :8080");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            #[cfg(unix)]
            {
                let mut terminate =
                    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                        .expect("install SIGTERM handler");
                tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
            }
            #[cfg(not(unix))]
            {
                let _ = tokio::signal::ctrl_c().await;
            }
        })
        .await?;
    Ok(())
}
