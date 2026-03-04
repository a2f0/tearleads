//! WASM bindings for `tearleads-api-domain-core`.

#[cfg(any(test, target_arch = "wasm32"))]
use tearleads_api_domain_core::{canonical_sql_identifier_field, normalize_sql_identifier};
use tearleads_api_domain_core::{normalize_redis_scan_cursor, normalize_redis_scan_limit};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

#[cfg(any(test, target_arch = "wasm32"))]
fn normalize_sql_identifier_inner(field: &str, value: &str) -> Result<String, String> {
    let canonical_field = canonical_sql_identifier_field(field)
        .ok_or_else(|| String::from("field: unsupported identifier field"))?;

    normalize_sql_identifier(canonical_field, value).map_err(|error| error.to_string())
}

/// Normalizes a Redis SCAN cursor value for API domain consumption.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen(js_name = normalizeRedisScanCursor))]
pub fn normalize_redis_scan_cursor_binding(cursor: &str) -> String {
    normalize_redis_scan_cursor(cursor)
}

/// Normalizes a Redis SCAN limit to the safe `[1, 100]` range.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen(js_name = normalizeRedisScanLimit))]
pub fn normalize_redis_scan_limit_binding(limit: i32) -> u32 {
    normalize_redis_scan_limit(limit)
}

/// Normalizes a SQL identifier and reports validation failures as JS errors.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = normalizeSqlIdentifier)]
pub fn normalize_sql_identifier_binding(field: &str, value: &str) -> Result<String, JsValue> {
    normalize_sql_identifier_inner(field, value).map_err(|error| JsValue::from_str(&error))
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_redis_scan_cursor_binding, normalize_redis_scan_limit_binding,
        normalize_sql_identifier_inner,
    };

    #[test]
    fn redis_cursor_normalization_matches_domain_behavior() {
        assert_eq!(normalize_redis_scan_cursor_binding(""), "0");
        assert_eq!(normalize_redis_scan_cursor_binding(" 42 "), "42");
    }

    #[test]
    fn redis_limit_normalization_matches_domain_behavior() {
        assert_eq!(normalize_redis_scan_limit_binding(-1), 50);
        assert_eq!(normalize_redis_scan_limit_binding(0), 50);
        assert_eq!(normalize_redis_scan_limit_binding(75), 75);
        assert_eq!(normalize_redis_scan_limit_binding(1000), 100);
    }

    #[test]
    fn sql_identifier_normalization_accepts_valid_input() {
        assert_eq!(
            normalize_sql_identifier_inner("table", "  users_2026  "),
            Ok(String::from("users_2026"))
        );
    }

    #[test]
    fn sql_identifier_normalization_rejects_invalid_input() {
        let blank = normalize_sql_identifier_inner("schema", " ");
        assert_eq!(
            blank,
            Err(String::from("schema: identifier must not be empty"))
        );

        let unsafe_chars = normalize_sql_identifier_inner("table", "users;drop");
        assert_eq!(
            unsafe_chars,
            Err(String::from(
                "table: identifier must contain only ASCII letters, digits, or underscores",
            ))
        );

        let unsupported_field = normalize_sql_identifier_inner("organization", "org_1");
        assert_eq!(
            unsupported_field,
            Err(String::from("field: unsupported identifier field"))
        );
    }
}
