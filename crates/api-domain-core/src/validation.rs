//! Stateless validation and normalization helpers.

use std::{error::Error, fmt};

const SUPPORTED_SQL_IDENTIFIER_FIELDS: [&str; 4] = ["schema", "table", "key", "cursor"];
const DEFAULT_ADMIN_ROWS_LIMIT: u32 = 50;
const MAX_ADMIN_ROWS_LIMIT: u32 = 1_000;

/// Validation error for user-controlled domain inputs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DomainValidationError {
    field: &'static str,
    message: String,
}

impl DomainValidationError {
    /// Creates a new validation error for the given field.
    pub fn new(field: &'static str, message: impl Into<String>) -> Self {
        Self {
            field,
            message: message.into(),
        }
    }

    /// Returns the invalid field name.
    pub fn field(&self) -> &'static str {
        self.field
    }

    /// Returns the validation message.
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for DomainValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.field, self.message)
    }
}

impl Error for DomainValidationError {}

/// Normalizes a Redis SCAN cursor, defaulting blank values to `"0"`.
pub fn normalize_redis_scan_cursor(cursor: &str) -> String {
    let trimmed = cursor.trim();
    if trimmed.is_empty() {
        return String::from("0");
    }
    trimmed.to_string()
}

/// Normalizes Redis SCAN limits to the production-safe range `[1, 100]`.
pub fn normalize_redis_scan_limit(limit: i32) -> u32 {
    if limit <= 0 {
        return 50;
    }

    let clamped = limit.min(100);
    clamped as u32
}

/// Normalizes SQL identifiers while rejecting unsafe/empty values.
pub fn normalize_sql_identifier(
    field: &'static str,
    value: &str,
) -> Result<String, DomainValidationError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(DomainValidationError::new(
            field,
            "identifier must not be empty",
        ));
    }

    if !trimmed
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    {
        return Err(DomainValidationError::new(
            field,
            "identifier must contain only ASCII letters, digits, or underscores",
        ));
    }

    Ok(trimmed.to_string())
}

/// Resolves dynamic field names to canonical SQL identifier fields.
pub fn canonical_sql_identifier_field(field: &str) -> Option<&'static str> {
    SUPPORTED_SQL_IDENTIFIER_FIELDS
        .iter()
        .copied()
        .find(|candidate| *candidate == field)
}

/// Normalizes required resource identifiers while rejecting blank values.
pub fn normalize_required_resource_id(
    field: &'static str,
    value: &str,
) -> Result<String, DomainValidationError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(DomainValidationError::new(field, "must not be empty"));
    }

    Ok(trimmed.to_string())
}

/// Normalizes optional sort directions to canonical lower-case values.
pub fn normalize_sort_direction(
    field: &'static str,
    value: Option<String>,
) -> Result<Option<String>, DomainValidationError> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if trimmed.eq_ignore_ascii_case("asc") {
        return Ok(Some(String::from("asc")));
    }
    if trimmed.eq_ignore_ascii_case("desc") {
        return Ok(Some(String::from("desc")));
    }

    Err(DomainValidationError::new(
        field,
        "must be \"asc\" or \"desc\"",
    ))
}

/// Normalizes optional organization identifiers by trimming empty values to `None`.
pub fn normalize_optional_organization_id(value: Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Normalizes required Redis keys while rejecting blank values.
pub fn normalize_required_redis_key(key: &str) -> Result<String, DomainValidationError> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err(DomainValidationError::new("key", "must not be empty"));
    }
    Ok(trimmed.to_string())
}

/// Normalizes admin rows limits to defaults and a max safety cap.
pub fn normalize_admin_rows_limit(limit: u32) -> u32 {
    if limit == 0 {
        return DEFAULT_ADMIN_ROWS_LIMIT;
    }

    limit.min(MAX_ADMIN_ROWS_LIMIT)
}

#[cfg(test)]
mod tests {
    use super::{
        DomainValidationError, canonical_sql_identifier_field, normalize_admin_rows_limit,
        normalize_optional_organization_id, normalize_redis_scan_cursor,
        normalize_redis_scan_limit, normalize_required_redis_key, normalize_required_resource_id,
        normalize_sort_direction, normalize_sql_identifier,
    };

    #[test]
    fn cursor_defaults_to_zero_when_blank() {
        assert_eq!(normalize_redis_scan_cursor("   "), "0");
    }

    #[test]
    fn cursor_is_trimmed_when_present() {
        assert_eq!(normalize_redis_scan_cursor(" 42 "), "42");
    }

    #[test]
    fn scan_limit_defaults_to_fifty_for_non_positive_values() {
        assert_eq!(normalize_redis_scan_limit(0), 50);
        assert_eq!(normalize_redis_scan_limit(-10), 50);
    }

    #[test]
    fn scan_limit_caps_at_one_hundred() {
        assert_eq!(normalize_redis_scan_limit(200), 100);
        assert_eq!(normalize_redis_scan_limit(64), 64);
    }

    #[test]
    fn sql_identifier_accepts_alphanumeric_underscore_values() {
        let normalized = match normalize_sql_identifier("table", " user_events_2026 ") {
            Ok(value) => value,
            Err(error) => panic!("identifier should validate: {error}"),
        };

        assert_eq!(normalized, "user_events_2026");
    }

    #[test]
    fn sql_identifier_rejects_empty_and_unsafe_values() {
        let empty_error = match normalize_sql_identifier("schema", "   ") {
            Ok(value) => panic!("blank identifiers must fail, got: {value}"),
            Err(error) => error,
        };
        assert_eq!(
            empty_error,
            DomainValidationError::new("schema", "identifier must not be empty")
        );

        let unsafe_error = match normalize_sql_identifier("table", "events;drop") {
            Ok(value) => panic!("unsafe chars fail, got: {value}"),
            Err(error) => error,
        };
        assert_eq!(
            unsafe_error,
            DomainValidationError::new(
                "table",
                "identifier must contain only ASCII letters, digits, or underscores",
            )
        );
    }

    #[test]
    fn canonical_sql_identifier_field_resolves_known_fields() {
        assert_eq!(canonical_sql_identifier_field("schema"), Some("schema"));
        assert_eq!(canonical_sql_identifier_field("table"), Some("table"));
        assert_eq!(canonical_sql_identifier_field("key"), Some("key"));
        assert_eq!(canonical_sql_identifier_field("cursor"), Some("cursor"));
        assert_eq!(canonical_sql_identifier_field("organization"), None);
    }

    #[test]
    fn required_resource_id_trims_and_rejects_blank_values() {
        let normalized = match normalize_required_resource_id("id", " group-1 ") {
            Ok(value) => value,
            Err(error) => panic!("valid id should pass: {error}"),
        };
        assert_eq!(normalized, "group-1");

        let error = match normalize_required_resource_id("name", "   ") {
            Ok(value) => panic!("blank name should fail, got: {value}"),
            Err(error) => error,
        };
        assert_eq!(
            error,
            DomainValidationError::new("name", "must not be empty")
        );
    }

    #[test]
    fn sort_direction_normalization_is_canonicalized() {
        assert_eq!(normalize_sort_direction("sort_direction", None), Ok(None));
        assert_eq!(
            normalize_sort_direction("sort_direction", Some(String::from(""))),
            Ok(None)
        );
        assert_eq!(
            normalize_sort_direction("sort_direction", Some(String::from(" Asc "))),
            Ok(Some(String::from("asc")))
        );
        assert_eq!(
            normalize_sort_direction("sort_direction", Some(String::from("DESC"))),
            Ok(Some(String::from("desc")))
        );
        assert_eq!(
            normalize_sort_direction("sort_direction", Some(String::from("asc"))),
            Ok(Some(String::from("asc")))
        );
        assert_eq!(
            normalize_sort_direction("sort_direction", Some(String::from("desc"))),
            Ok(Some(String::from("desc")))
        );
    }

    #[test]
    fn sort_direction_normalization_rejects_invalid_values() {
        let error = match normalize_sort_direction("sort_direction", Some(String::from("sideways")))
        {
            Ok(value) => panic!("invalid direction should fail, got: {value:?}"),
            Err(error) => error,
        };

        assert_eq!(
            error,
            DomainValidationError::new("sort_direction", "must be \"asc\" or \"desc\"")
        );
    }

    #[test]
    fn optional_organization_id_normalization_trims_and_drops_blank_values() {
        assert_eq!(
            normalize_optional_organization_id(Some(String::from("  org-1  "))),
            Some(String::from("org-1"))
        );
        assert_eq!(
            normalize_optional_organization_id(Some(String::from("   "))),
            None
        );
        assert_eq!(normalize_optional_organization_id(None), None);
    }

    #[test]
    fn required_redis_key_normalization_trims_and_rejects_blank_values() {
        assert_eq!(
            normalize_required_redis_key("  feature_flag  "),
            Ok(String::from("feature_flag"))
        );

        let error = match normalize_required_redis_key("   ") {
            Ok(value) => panic!("blank key should fail, got: {value}"),
            Err(error) => error,
        };
        assert_eq!(
            error,
            DomainValidationError::new("key", "must not be empty")
        );
    }

    #[test]
    fn admin_rows_limit_normalization_defaults_and_caps() {
        assert_eq!(normalize_admin_rows_limit(0), 50);
        assert_eq!(normalize_admin_rows_limit(10), 10);
        assert_eq!(normalize_admin_rows_limit(5_000), 1_000);
    }
}
