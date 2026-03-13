use std::env;

use tracing_subscriber::EnvFilter;

use super::{ADMIN_HARNESS_ENV_KEY, DEFAULT_PORT};

pub(super) fn is_enabled_env_var(name: &str) -> bool {
    env::var(name)
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

pub(super) fn read_port() -> u16 {
    env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT)
}

pub(super) fn runtime_dependency_error_message(
    postgres_available: bool,
    redis_available: bool,
) -> Option<String> {
    let mut missing_dependencies = Vec::new();
    if !postgres_available {
        missing_dependencies.push("postgres");
    }
    if !redis_available {
        missing_dependencies.push("redis");
    }

    if missing_dependencies.is_empty() {
        return None;
    }

    Some(format!(
        "api-v2 runtime dependencies unavailable: missing {}. Set {ADMIN_HARNESS_ENV_KEY}=1 to run static fixtures intentionally.",
        missing_dependencies.join(", ")
    ))
}

pub(super) fn initialize_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::fmt().with_env_filter(filter).init();
}
