//! Public catalog JSON only. The database revision is the source of truth for
//! invalidation: a failed Redis write or a late reader cannot resurrect old data.
use crate::{ApiError, AppState, internal};
use redis::AsyncCommands;
use serde::{Serialize, de::DeserializeOwned};
use std::{future::Future, time::Duration};

pub async fn get<T, F>(state: &AppState, resource: &str, load: F) -> Result<T, ApiError>
where
    T: Serialize + DeserializeOwned,
    F: Future<Output = Result<T, ApiError>>,
{
    let revision: i64 = sqlx::query_scalar("SELECT version FROM catalog_revision")
        .fetch_one(&state.db)
        .await
        .map_err(internal)?;
    let key = format!("catalog:v1:{revision}:{resource}");
    let timer = state.monitoring.cache_read_seconds.with_label_values::<&str>(&[]).start_timer();
    let cached = tokio::time::timeout(Duration::from_millis(150), async {
        let mut connection = state.cache.get_multiplexed_async_connection().await?;
        connection.get::<_, Option<String>>(&key).await
    })
    .await;
    timer.observe_duration();
    let outcome = match cached {
        Ok(Ok(Some(json))) => match serde_json::from_str(&json) {
            Ok(value) => {
                state.monitoring.cache.with_label_values(&["hit"]).inc();
                return Ok(value);
            }
            Err(_) => "error",
        },
        Ok(Ok(None)) => "miss",
        _ => "error",
    };
    state.monitoring.cache.with_label_values(&[outcome]).inc();
    let value = load.await?;
    if let Ok(json) = serde_json::to_string(&value) {
        // Large responses must not evict the entire working set. Errors/404s
        // never enter Redis. Old revisions expire and are also subject to LRU.
        if json.len() <= 2 * 1024 * 1024 {
            let result = tokio::time::timeout(Duration::from_millis(150), async {
                let mut connection = state.cache.get_multiplexed_async_connection().await?;
                connection.set_ex::<_, _, ()>(&key, json, 3600).await
            })
            .await;
            state.monitoring.cache_writes.with_label_values(&[
                if matches!(result, Ok(Ok(()))) { "success" } else { "error" }
            ]).inc();
        } else {
            state.monitoring.cache_writes.with_label_values(&["skipped"]).inc();
        }
    } else {
        state.monitoring.cache_writes.with_label_values(&["error"]).inc();
    }
    Ok(value)
}
