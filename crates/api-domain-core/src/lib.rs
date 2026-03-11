//! Pure domain helpers shared between server and WASM-facing clients.

mod validation;

pub use validation::{
    DomainValidationError, canonical_sql_identifier_field, normalize_admin_rows_limit,
    normalize_optional_organization_id, normalize_redis_scan_cursor, normalize_redis_scan_limit,
    normalize_required_redis_key, normalize_required_resource_id, normalize_sort_direction,
    normalize_sql_identifier,
};
