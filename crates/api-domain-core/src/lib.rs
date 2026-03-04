//! Pure domain helpers shared between server and WASM-facing clients.

mod validation;

pub use validation::{
    DomainValidationError, normalize_redis_scan_cursor, normalize_redis_scan_limit,
    normalize_sql_identifier,
};
