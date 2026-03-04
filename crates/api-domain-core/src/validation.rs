//! Stateless validation and normalization helpers.

use std::{error::Error, fmt};

const SUPPORTED_SQL_IDENTIFIER_FIELDS: [&str; 4] = ["schema", "table", "key", "cursor"];

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

#[cfg(test)]
mod tests {
    use super::{
        DomainValidationError, canonical_sql_identifier_field, normalize_redis_scan_cursor,
        normalize_redis_scan_limit, normalize_sql_identifier,
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
}
