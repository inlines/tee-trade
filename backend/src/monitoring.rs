use crate::{ApiError, AppState, admin, internal};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use prometheus::{
    Gauge, GaugeVec, HistogramOpts, HistogramVec, IntCounterVec, IntGauge, IntGaugeVec, Opts,
    Registry,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
#[derive(Clone)]
pub struct Metrics {
    pub duration: HistogramVec,
    pub inflight: IntGauge,
    pub websockets: IntGaugeVec,
    pub cache: IntCounterVec,
    dependency: GaugeVec,
    probe_seconds: GaugeVec,
    pool: GaugeVec,
    business: GaugeVec,
    backlog: GaugeVec,
    cohorts: GaugeVec,
    business_up: Gauge,
    last_success: Gauge,
    started: Gauge,
    views_started: Gauge,
    oldest_request: Gauge,
}
impl Metrics {
    pub fn new(r: &Registry) -> Result<Self, prometheus::Error> {
        macro_rules! reg {
            ($m:expr) => {{
                let m = $m?;
                r.register(Box::new(m.clone()))?;
                m
            }};
        }
        Ok(Self {
            duration: reg!(HistogramVec::new(
                HistogramOpts::new(
                    "http_request_duration_seconds",
                    "Time until response headers; WebSocket lifetime is excluded"
                )
                .buckets(vec![
                    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0
                ]),
                &["route", "method", "status"]
            )),
            websockets: reg!(IntGaugeVec::new(
                Opts::new(
                    "tee_websocket_connections",
                    "Open chat and notification sockets"
                ),
                &["kind", "side"]
            )),
            inflight: reg!(IntGauge::new(
                "http_requests_in_flight",
                "Requests currently handled until response headers"
            )),
            cache: reg!(IntCounterVec::new(
                Opts::new("tee_catalog_cache_total", "Catalog cache outcomes"),
                &["result"]
            )),
            dependency: reg!(GaugeVec::new(
                Opts::new("tee_dependency_up", "Last dependency probe success"),
                &["dependency"]
            )),
            probe_seconds: reg!(GaugeVec::new(
                Opts::new(
                    "tee_dependency_probe_seconds",
                    "Last dependency probe duration"
                ),
                &["dependency"]
            )),
            pool: reg!(GaugeVec::new(
                Opts::new(
                    "tee_db_pool_connections",
                    "Application database pool connections"
                ),
                &["state"]
            )),
            business: reg!(GaugeVec::new(
                Opts::new(
                    "tee_business_events",
                    "Persisted event counts in rolling windows, not counters"
                ),
                &["window", "event"]
            )),
            backlog: reg!(GaugeVec::new(
                Opts::new("tee_requests_current", "Current request count by status"),
                &["status"]
            )),
            cohorts: reg!(GaugeVec::new(
                Opts::new(
                    "tee_business_funnel",
                    "Customer/product cohorts with a 7-day conversion horizon"
                ),
                &["window", "stage"]
            )),
            business_up: reg!(Gauge::new(
                "tee_business_collection_success",
                "Last business metrics collection succeeded"
            )),
            last_success: reg!(Gauge::new(
                "tee_business_last_success_timestamp_seconds",
                "Last successful business snapshot"
            )),
            started: reg!(Gauge::new(
                "tee_api_start_timestamp_seconds",
                "API process start time"
            )),
            views_started: reg!(Gauge::new(
                "tee_views_start_timestamp_seconds",
                "First deployment of product view tracking"
            )),
            oldest_request: reg!(Gauge::new(
                "tee_oldest_new_request_seconds",
                "Age of the oldest unprocessed request; zero when empty"
            )),
        })
    }
    pub fn start(&self, state: AppState) {
        self.started.set(now());
        for kind in ["chat", "notifications"] {
            for side in ["admin", "customer"] {
                self.websockets.with_label_values(&[kind, side]).set(0);
            }
        }

        for result in ["hit", "miss", "error"] {
            self.cache.with_label_values(&[result]).inc_by(0);
        }
        let m = self.clone();
        tokio::spawn(async move {
            let mut timer = tokio::time::interval(Duration::from_secs(15));
            timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut tick = 0u64;
            loop {
                timer.tick().await;
                let start = Instant::now();
                let ok = matches!(
                    tokio::time::timeout(
                        Duration::from_secs(2),
                        sqlx::query("SELECT 1").execute(&state.db)
                    )
                    .await,
                    Ok(Ok(_))
                );
                m.dependency
                    .with_label_values(&["postgres"])
                    .set(if ok { 1.0 } else { 0.0 });
                m.probe_seconds
                    .with_label_values(&["postgres"])
                    .set(start.elapsed().as_secs_f64());
                let start = Instant::now();
                let ok = matches!(
                    tokio::time::timeout(Duration::from_secs(2), async {
                        let mut c = state.cache.get_multiplexed_async_connection().await?;
                        redis::cmd("PING").query_async::<String>(&mut c).await
                    })
                    .await,
                    Ok(Ok(_))
                );
                m.dependency
                    .with_label_values(&["redis"])
                    .set(if ok { 1.0 } else { 0.0 });
                m.probe_seconds
                    .with_label_values(&["redis"])
                    .set(start.elapsed().as_secs_f64());
                m.pool
                    .with_label_values(&["open"])
                    .set(state.db.size() as f64);
                m.pool
                    .with_label_values(&["idle"])
                    .set(state.db.num_idle() as f64);
                if tick % 4 == 0 {
                    match tokio::time::timeout(Duration::from_secs(12), m.collect(&state)).await {
                        Ok(Ok(())) => {
                            m.business_up.set(1.0);
                            m.last_success.set(now());
                        }
                        other => {
                            m.business_up.set(0.0);
                            tracing::warn!(error=?other,"Business metric collection failed");
                        }
                    }
                }
                tick = tick.wrapping_add(1);
            }
        });
    }
    async fn collect(&self, s: &AppState) -> Result<(), sqlx::Error> {
        let mut tx = s.db.begin().await?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            .execute(&mut *tx)
            .await?;
        sqlx::query("SET LOCAL statement_timeout='3s'")
            .execute(&mut *tx)
            .await?;
        let started: f64 = sqlx::query_scalar(
            "SELECT extract(epoch FROM views_started_at)::float8 FROM analytics_metadata",
        )
        .fetch_one(&mut *tx)
        .await?;
        let oldest:f64=sqlx::query_scalar("SELECT COALESCE(extract(epoch FROM now()-min(created_at)),0)::float8 FROM purchase_requests WHERE status='new'").fetch_one(&mut *tx).await?;
        let mut events = Vec::new();
        let mut cohorts = Vec::new();
        for (window, seconds) in [
            ("24h", 86400i64),
            ("7d", 604800),
            ("30d", 2592000),
            ("90d", 7776000),
        ] {
            let rows: Vec<(String, i64)> = sqlx::query_as(include_str!("business_events.sql"))
                .bind(seconds)
                .fetch_all(&mut *tx)
                .await?;
            for (event, count) in rows {
                events.push((window, event, count));
            }
            let rows: Vec<(String, i64)> = sqlx::query_as(include_str!("business_funnel.sql"))
                .bind(seconds)
                .fetch_all(&mut *tx)
                .await?;
            for (stage, count) in rows {
                cohorts.push((window, stage, count));
            }
        }
        let backlog: Vec<(String, i64)> =
            sqlx::query_as("SELECT status,count(*) FROM purchase_requests GROUP BY status")
                .fetch_all(&mut *tx)
                .await?;
        tx.commit().await?;
        for (window, event, count) in events {
            self.business
                .with_label_values(&[window, &event])
                .set(count as f64);
        }
        for (window, stage, count) in cohorts {
            self.cohorts
                .with_label_values(&[window, &stage])
                .set(count as f64);
        }
        for status in ["new", "in_progress", "completed"] {
            self.backlog.with_label_values(&[status]).set(
                backlog
                    .iter()
                    .find(|(s, _)| s == status)
                    .map_or(0, |(_, n)| *n) as f64,
            );
        }
        self.views_started.set(started);
        self.oldest_request.set(oldest);
        // Keep only the bounded attribution horizon. No IPs, contacts or message bodies are recorded.
        sqlx::query("DELETE FROM product_views WHERE id IN (SELECT id FROM product_views WHERE created_at < now()-interval '98 days' LIMIT 10000)").execute(&s.db).await?;
        Ok(())
    }
}
fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}
pub struct Inflight(pub IntGauge);
impl Drop for Inflight {
    fn drop(&mut self) {
        self.0.dec();
    }
}
fn cookie<'a>(h: &'a HeaderMap, prefix: &str) -> Option<&'a str> {
    h.get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|v| v.trim().strip_prefix(prefix))
        .filter(|v| v.len() == 64 && v.bytes().all(|c| c.is_ascii_hexdigit()))
}
pub async fn view(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(id): Path<i32>,
) -> Result<Response, ApiError> {
    admin::check_origin(&h, &s)?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM products WHERE id=$1 AND NOT is_demo)")
            .bind(id)
            .fetch_one(&s.db)
            .await
            .map_err(internal)?;
    if !exists {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }
    let customer: Option<i64> = if let Some(token) = cookie(&h, "tt_customer=") {
        sqlx::query_scalar(
            "SELECT customer_id FROM customer_sessions WHERE token_hash=$1 AND expires_at>now()",
        )
        .bind(admin::hash_token(token))
        .fetch_optional(&s.db)
        .await
        .map_err(internal)?
    } else {
        None
    };
    let visitor = cookie(&h, "tt_visitor=")
        .map(str::to_owned)
        .unwrap_or_else(admin::token);
    let key = customer.map_or_else(
        || admin::hash_token(&visitor),
        |id| admin::hash_token(&format!("customer:{id}")),
    );
    sqlx::query("INSERT INTO product_views(product_id,customer_id,visitor_hash,bucket) VALUES($1,$2,$3,date_bin(interval '30 minutes',now(),timestamptz '2000-01-01')) ON CONFLICT(product_id,visitor_hash,bucket) DO NOTHING").bind(id).bind(customer).bind(key).execute(&s.db).await.map_err(internal)?;
    let value = format!(
        "tt_visitor={visitor}; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=7776000{}",
        if s.secure_cookie { "; Secure" } else { "" }
    );
    Ok((
        StatusCode::NO_CONTENT,
        [
            (header::SET_COOKIE, value),
            (header::CACHE_CONTROL, "no-store".into()),
        ],
    )
        .into_response())
}
