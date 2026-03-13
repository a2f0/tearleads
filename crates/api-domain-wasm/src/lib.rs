//! WASM bindings for `tearleads-api-domain-core`.

#[cfg(any(test, target_arch = "wasm32"))]
use tearleads_api_domain_core::{canonical_sql_identifier_field, normalize_sql_identifier};
use tearleads_api_domain_core::{
    normalize_admin_rows_limit, normalize_optional_organization_id, normalize_redis_scan_cursor,
    normalize_redis_scan_limit, normalize_required_redis_key,
};
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

// -- required resource id ----------------------------------------------------

// Inlined because `normalize_required_resource_id` takes `field: &'static str`
// which is incompatible with wasm_bindgen's borrowed `&str` parameters.
fn normalize_required_resource_id_inner(field: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field}: must not be empty"));
    }
    Ok(trimmed.to_string())
}

/// Normalizes a required resource identifier, rejecting blank values.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = normalizeRequiredResourceId)]
pub fn normalize_required_resource_id_binding(field: &str, value: &str) -> Result<String, JsValue> {
    normalize_required_resource_id_inner(field, value).map_err(|error| JsValue::from_str(&error))
}

// -- sort direction ----------------------------------------------------------

// Inlined because `normalize_sort_direction` takes `field: &'static str`.
fn normalize_sort_direction_inner(
    field: &str,
    value: Option<String>,
) -> Result<Option<String>, String> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim().to_string();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.eq_ignore_ascii_case("asc") {
        return Ok(Some(String::from("asc")));
    }
    if trimmed.eq_ignore_ascii_case("desc") {
        return Ok(Some(String::from("desc")));
    }
    Err(format!("{field}: must be \"asc\" or \"desc\""))
}

/// Normalizes an optional sort direction to canonical lower-case values.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = normalizeSortDirection)]
pub fn normalize_sort_direction_binding(
    field: &str,
    value: Option<String>,
) -> Result<Option<String>, JsValue> {
    normalize_sort_direction_inner(field, value).map_err(|error| JsValue::from_str(&error))
}

// -- optional organization id ------------------------------------------------

/// Normalizes an optional organization identifier by trimming empty values to `None`.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen(js_name = normalizeOptionalOrganizationId))]
pub fn normalize_optional_organization_id_binding(value: Option<String>) -> Option<String> {
    normalize_optional_organization_id(value)
}

// -- required redis key ------------------------------------------------------

fn normalize_required_redis_key_inner(key: &str) -> Result<String, String> {
    normalize_required_redis_key(key).map_err(|error| error.to_string())
}

/// Normalizes a required Redis key, rejecting blank values.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = normalizeRequiredRedisKey)]
pub fn normalize_required_redis_key_binding(key: &str) -> Result<String, JsValue> {
    normalize_required_redis_key_inner(key).map_err(|error| JsValue::from_str(&error))
}

// -- admin rows limit --------------------------------------------------------

/// Normalizes admin rows limits with defaults and a max safety cap.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen(js_name = normalizeAdminRowsLimit))]
pub fn normalize_admin_rows_limit_binding(limit: u32) -> u32 {
    normalize_admin_rows_limit(limit)
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_admin_rows_limit_binding, normalize_optional_organization_id_binding,
        normalize_redis_scan_cursor_binding, normalize_redis_scan_limit_binding,
        normalize_required_redis_key_inner, normalize_required_resource_id_inner,
        normalize_sort_direction_inner, normalize_sql_identifier_inner,
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

    #[test]
    fn required_resource_id_trims_and_rejects_blank() {
        assert_eq!(
            normalize_required_resource_id_inner("id", " group-1 "),
            Ok(String::from("group-1"))
        );
        let error = normalize_required_resource_id_inner("name", "   ");
        assert_eq!(error, Err(String::from("name: must not be empty")));
    }

    #[test]
    fn sort_direction_normalizes_to_canonical_values() {
        assert_eq!(normalize_sort_direction_inner("sort", None), Ok(None));
        assert_eq!(
            normalize_sort_direction_inner("sort", Some(String::from(" ASC "))),
            Ok(Some(String::from("asc")))
        );
        assert_eq!(
            normalize_sort_direction_inner("sort", Some(String::from("DESC"))),
            Ok(Some(String::from("desc")))
        );
        let error = normalize_sort_direction_inner("sort", Some(String::from("sideways")));
        assert_eq!(
            error,
            Err(String::from("sort: must be \"asc\" or \"desc\""))
        );
    }

    #[test]
    fn optional_organization_id_trims_and_drops_blank() {
        assert_eq!(
            normalize_optional_organization_id_binding(Some(String::from("  org-1  "))),
            Some(String::from("org-1"))
        );
        assert_eq!(
            normalize_optional_organization_id_binding(Some(String::from("   "))),
            None
        );
        assert_eq!(normalize_optional_organization_id_binding(None), None);
    }

    #[test]
    fn required_redis_key_trims_and_rejects_blank() {
        assert_eq!(
            normalize_required_redis_key_inner("  feature_flag  "),
            Ok(String::from("feature_flag"))
        );
        let error = normalize_required_redis_key_inner("   ");
        assert_eq!(error, Err(String::from("key: must not be empty")));
    }

    #[test]
    fn admin_rows_limit_defaults_and_caps() {
        assert_eq!(normalize_admin_rows_limit_binding(0), 50);
        assert_eq!(normalize_admin_rows_limit_binding(10), 10);
        assert_eq!(normalize_admin_rows_limit_binding(5_000), 1_000);
    }
}
