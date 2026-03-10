//! Pure domain helpers shared between server and WASM-facing clients.

mod validation;

pub use validation::{
    DomainValidationError, canonical_sql_identifier_field, normalize_redis_scan_cursor,
    normalize_redis_scan_limit, normalize_required_resource_id, normalize_sort_direction,
    normalize_sql_identifier,
};
