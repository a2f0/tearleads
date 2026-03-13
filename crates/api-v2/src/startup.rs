use super::{ADMIN_HARNESS_ENV_KEY, DEFAULT_PORT};

pub(super) fn is_enabled_env_value(value: Option<&str>) -> bool {
    value
        .map(|entry| {
            matches!(
                entry.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

pub(super) fn read_port_value(value: Option<&str>) -> u16 {
    value
        .and_then(|entry| entry.parse::<u16>().ok())
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
