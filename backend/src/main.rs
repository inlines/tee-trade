mod admin;
mod chat;
mod customers;
use axum::{
    Json, Router,
    extract::{Path, Query, Request, State},
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
    admin_origin: String,
    secure_cookie: bool,
    chat_events: tokio::sync::broadcast::Sender<chat::Event>,
}
#[derive(Serialize, Deserialize)]
struct ProductImage {
    url: String,
    alt: String,
    kind: String,
}
#[derive(Serialize, Deserialize, sqlx::FromRow)]
struct Product {
    id: i32,
    name: String,
    price_cents: Option<i32>,
    category: String,
    brand: String,
    release_year: Option<i32>,
    description: String,
    theme: String,
    images: sqlx::types::Json<Vec<ProductImage>>,
    is_demo: bool,
}
const PRODUCT_COLUMNS: &str =
    "id, name, price_cents, category, brand, release_year, description, theme, images, is_demo";
const CATEGORIES: [&str; 4] = ["sneakers", "t-shirts", "accessories", "headwear"];
#[derive(Deserialize)]
struct CatalogQuery {
    category: Option<String>,
}
type ApiError = (StatusCode, &'static str);
fn internal(error: impl std::fmt::Display) -> ApiError {
    tracing::error!(%error, "request failed");
    (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error")
}
async fn products(
    State(state): State<AppState>,
    Query(query): Query<CatalogQuery>,
) -> Result<Json<Vec<Product>>, ApiError> {
    if let Some(category) = &query.category {
        if !CATEGORIES.contains(&category.as_str()) {
            return Err((StatusCode::BAD_REQUEST, "Unknown category"));
        }
    }
    let revision: i64 = sqlx::query_scalar("SELECT version FROM catalog_revision")
        .fetch_one(&state.db)
        .await
        .map_err(internal)?;
    let key = format!(
        "products:v3:{revision}:{}",
        query.category.as_deref().unwrap_or("all")
    );
    let mut cache = state.cache.get_multiplexed_async_connection().await.ok();
    if let Some(connection) = cache.as_mut() {
        if let Ok(Some(value)) = connection.get::<_, Option<String>>(&key).await {
            if let Ok(products) = serde_json::from_str(&value) {
                return Ok(Json(products));
            }
        }
    }
    let products = sqlx::query_as::<_, Product>(&format!(
        "SELECT {PRODUCT_COLUMNS} FROM products WHERE ($1::text IS NULL OR category = $1) ORDER BY id"
    )).bind(query.category).fetch_all(&state.db).await.map_err(internal)?;
    if let Some(connection) = cache.as_mut() {
        if let Ok(value) = serde_json::to_string(&products) {
            let _: redis::RedisResult<()> = connection.set_ex(&key, value, 60).await;
        }
    }
    Ok(Json(products))
}
async fn product(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> Result<Json<Product>, ApiError> {
    sqlx::query_as::<_, Product>(&format!(
        "SELECT {PRODUCT_COLUMNS} FROM products WHERE id = $1"
    ))
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?
    .map(Json)
    .ok_or((StatusCode::NOT_FOUND, "Product not found"))
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
    admin::bootstrap(&db).await?;
    let registry = Registry::new();
    let requests = IntCounterVec::new(
        prometheus::Opts::new("http_requests_total", "HTTP responses"),
        &["route", "status"],
    )?;
    registry.register(Box::new(requests.clone()))?;
    let state = AppState {
        chat_events: tokio::sync::broadcast::channel(1024).0,
        db,
        cache: redis::Client::open(std::env::var("REDIS_URL")?)?,
        registry,
        requests,
        admin_origin: std::env::var("APP_ORIGIN")
            .unwrap_or_else(|_| "http://localhost:4200".into()),
        secure_cookie: std::env::var("COOKIE_SECURE").is_ok_and(|value| value == "true"),
    };
    let app = Router::new()
        .merge(admin::routes(state.clone()))
        .merge(customers::routes())
        .merge(chat::routes())
        .route("/api/storefront", get(admin::storefront))
        .route("/api/media/{id}", get(admin::media))
        .route("/api/products", get(products))
        .route("/api/products/{id}", get(product))
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
