mod admin;
mod catalog_cache;
mod chat;
mod customers;
mod media_store;
mod monitoring;
mod requests;
use axum::{
    Json, Router,
    extract::{Path, Query, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use prometheus::{Encoder, IntCounterVec, Registry, TextEncoder};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Clone)]
struct AppState {
    db: PgPool,
    cache: redis::Client,
    registry: Registry,
    requests: IntCounterVec,
    monitoring: monitoring::Metrics,
    admin_origin: String,
    secure_cookie: bool,
    request_events: tokio::sync::broadcast::Sender<i64>,
    chat_updates: tokio::sync::broadcast::Sender<i64>,
    chat_events: tokio::sync::broadcast::Sender<chat::Event>,
}
#[derive(Serialize, Deserialize)]
struct ProductImage {
    #[serde(default)]
    carousel: bool,
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
    brands: Vec<String>,
    size: String,
    description: String,
    theme: String,
    images: sqlx::types::Json<Vec<ProductImage>>,
    is_demo: bool,
    sold: bool,
}
const PRODUCT_COLUMNS: &str = "id, name, price_cents, category, brands, size, description, theme, images, is_demo, sold";
const CATEGORIES: [&str; 7] = ["sneakers", "t-shirts", "accessories", "headwear", "hoodies", "sweatshirts", "longsleeves"];
#[derive(Deserialize)]
struct CatalogQuery {
    category: Option<String>,
    #[serde(default)]
    sold: bool,
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
    let resource = format!(
        "products:{}:{}",
        query.sold,
        query.category.as_deref().unwrap_or("all")
    );
    catalog_cache::get(&state, &resource, async {
        sqlx::query_as::<_, Product>(&format!(
            "SELECT {PRODUCT_COLUMNS} FROM products WHERE ($1::text IS NULL OR category = $1) AND sold=$2 ORDER BY id"
        )).bind(query.category).bind(query.sold).fetch_all(&state.db).await.map_err(internal)
    }).await.map(Json)
}
#[derive(Deserialize)]
struct PageQuery {
    category: Option<String>,
    #[serde(default)]
    sold: bool,
    limit: i64,
    #[serde(default)]
    offset: i64,
    #[serde(default)]
    sort: String,
    brands: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct ProductPage {
    items: Vec<Product>,
    total: i64,
    brands: Vec<String>,
}
async fn product_page(
    State(state): State<AppState>,
    Query(query): Query<PageQuery>,
) -> Result<Json<ProductPage>, ApiError> {
    if ![4, 8].contains(&query.limit) || query.offset < 0 || query.offset > 1_000_000 {
        return Err((StatusCode::BAD_REQUEST, "Invalid pagination"));
    }
    if query
        .category
        .as_ref()
        .is_some_and(|c| !CATEGORIES.contains(&c.as_str()))
    {
        return Err((StatusCode::BAD_REQUEST, "Unknown category"));
    }
    let mut selected: Vec<String> = match query.brands.as_deref() {
        Some(raw) => {
            serde_json::from_str(raw).map_err(|_| (StatusCode::BAD_REQUEST, "Invalid brands"))?
        }
        None => Vec::new(),
    };
    if selected.len() > 50
        || selected
            .iter()
            .any(|b| b.trim().is_empty() || b.chars().count() > 100)
    {
        return Err((StatusCode::BAD_REQUEST, "Invalid brands"));
    }
    selected = selected
        .into_iter()
        .map(|b| b.trim().to_lowercase())
        .collect();
    selected.sort();
    selected.dedup();
    let order = match query.sort.as_str() {
        "" | "default" => "id ASC",
        "price-asc" => "price_cents ASC NULLS LAST, id ASC",
        "price-desc" => "price_cents DESC NULLS LAST, id ASC",
        _ => return Err((StatusCode::BAD_REQUEST, "Unknown sort")),
    };
    let key = format!(
        "page-brands:{}:{}:{}:{}:{}:{}",
        query.sold,
        query.category.as_deref().unwrap_or("all"),
        query.limit,
        query.offset,
        order,
        serde_json::to_string(&selected).map_err(internal)?
    );
    catalog_cache::get(&state, &key, async {
        let mut tx = state.db.begin().await.map_err(internal)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY").execute(&mut *tx).await.map_err(internal)?;
        let total = sqlx::query_scalar("SELECT count(*) FROM products WHERE ($1::text IS NULL OR category=$1) AND sold=$2 AND (cardinality($3::text[]) = 0 OR EXISTS (SELECT 1 FROM unnest(brands) b WHERE lower(btrim(b)) = ANY($3)))")
            .bind(&query.category).bind(query.sold).bind(&selected).fetch_one(&mut *tx).await.map_err(internal)?;
        let items = sqlx::query_as::<_, Product>(&format!("SELECT {PRODUCT_COLUMNS} FROM products WHERE ($1::text IS NULL OR category=$1) AND sold=$2 AND (cardinality($5::text[]) = 0 OR EXISTS (SELECT 1 FROM unnest(brands) b WHERE lower(btrim(b)) = ANY($5))) ORDER BY {order} LIMIT $3 OFFSET $4"))
            .bind(&query.category).bind(query.sold).bind(query.limit).bind(query.offset).bind(&selected).fetch_all(&mut *tx).await.map_err(internal)?;
        // Facet excludes its own selection and pagination, but respects every other filter.
        let brands = sqlx::query_scalar::<_, String>("SELECT min(btrim(brand)) FROM products CROSS JOIN LATERAL unnest(brands) AS brand WHERE ($1::text IS NULL OR category=$1) AND sold=$2 AND btrim(brand) <> '' GROUP BY lower(btrim(brand)) ORDER BY lower(btrim(brand))")
            .bind(&query.category).bind(query.sold).fetch_all(&mut *tx).await.map_err(internal)?;
        tx.commit().await.map_err(internal)?;
        Ok(ProductPage {items, total, brands})
    }).await.map(Json)
}

async fn product(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> Result<Json<Product>, ApiError> {
    catalog_cache::get(&state, &format!("product:{id}"), async {
        sqlx::query_as::<_, Product>(&format!(
            "SELECT {PRODUCT_COLUMNS} FROM products WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, "Product not found"))
    })
    .await
    .map(Json)
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
    let method = match request.method().as_str() {
        "GET" => "GET",
        "POST" => "POST",
        "PUT" => "PUT",
        "PATCH" => "PATCH",
        "DELETE" => "DELETE",
        "HEAD" => "HEAD",
        "OPTIONS" => "OPTIONS",
        _ => "OTHER",
    };
    let started = std::time::Instant::now();
    state.monitoring.inflight.inc();
    let _inflight = monitoring::Inflight(state.monitoring.inflight.clone());
    let response = next.run(request).await;
    state
        .monitoring
        .duration
        .with_label_values(&[path.as_str(), method, response.status().as_str()])
        .observe(started.elapsed().as_secs_f64());
    state
        .requests
        .with_label_values(&[path.as_str(), response.status().as_str()])
        .inc();
    response
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let db = PgPool::connect(&std::env::var("DATABASE_URL")?).await?;
    sqlx::migrate!().run(&db).await?;
    media_store::initialize().await?;
    if let Some(mode) = std::env::args().nth(1) {
        media_store::run(&db, &mode, std::env::args().nth(2).as_deref()).await?;
        return Ok(());
    }
    let cleanup_db = db.clone();
    tokio::spawn(async move {
        loop {
            if let Err(error) = media_store::cleanup(&cleanup_db).await {
                tracing::error!(%error,"media file cleanup failed; will retry");
            }
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        }
    });
    admin::bootstrap(&db).await?;
    let registry = Registry::new();
    let requests = IntCounterVec::new(
        prometheus::Opts::new("http_requests_total", "HTTP responses"),
        &["route", "status"],
    )?;
    registry.register(Box::new(requests.clone()))?;
    let monitoring = monitoring::Metrics::new(&registry)?;
    let state = AppState {
        monitoring,
        request_events: tokio::sync::broadcast::channel(1024).0,
        chat_updates: tokio::sync::broadcast::channel(1024).0,
        chat_events: tokio::sync::broadcast::channel(1024).0,
        db,
        cache: redis::Client::open(std::env::var("REDIS_URL")?)?,
        registry,
        requests,
        admin_origin: std::env::var("APP_ORIGIN")
            .unwrap_or_else(|_| "http://localhost:4200".into()),
        secure_cookie: std::env::var("COOKIE_SECURE").is_ok_and(|value| value == "true"),
    };
    state.monitoring.start(state.clone());
    let app = Router::new()
        .merge(admin::routes(state.clone()))
        .merge(customers::routes())
        .merge(chat::routes())
        .merge(requests::routes())
        .route(
            "/api/auth/product-views/{id}",
            axum::routing::post(monitoring::view),
        )
        .route("/api/storefront", get(admin::storefront))
        .route("/api/media/{id}", get(admin::media))
        .route("/api/media/{id}/preview", get(admin::media_preview))
        .route("/api/products", get(products))
        .route("/api/products/page", get(product_page))
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
