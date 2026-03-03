//! WASM scaffold exports for the `@tearleads/mls-core` runtime.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::wasm_bindgen;

/// Stable Rust/WASM backend identifier for `mls-core`.
pub const MLS_BACKEND_NAME: &str = "tearleads-mls-core-wasm";

/// Current crate version exposed to JavaScript.
pub const MLS_BACKEND_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Runtime notice surfaced while MLS RFC 9420 primitives are still pending.
pub const MLS_BACKEND_NOTICE: &str =
    "Rust/WASM MLS backend scaffold is loaded, but RFC 9420 primitives are not implemented yet.";

/// Returns the backend identifier.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_backend_name() -> String {
    MLS_BACKEND_NAME.to_owned()
}

/// Returns the backend crate version.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_backend_version() -> String {
    MLS_BACKEND_VERSION.to_owned()
}

/// Returns whether the Rust/WASM backend is production-ready.
///
/// This remains `false` until full RFC 9420 primitives are implemented.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_backend_ready() -> bool {
    false
}

/// Returns an operator-facing backend readiness note.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_backend_notice() -> String {
    MLS_BACKEND_NOTICE.to_owned()
}

#[cfg(test)]
mod tests {
    use super::{
        MLS_BACKEND_NAME, MLS_BACKEND_NOTICE, MLS_BACKEND_VERSION, mls_backend_name,
        mls_backend_notice, mls_backend_ready, mls_backend_version,
    };

    #[test]
    fn exposes_backend_name() {
        assert_eq!(mls_backend_name(), MLS_BACKEND_NAME.to_owned());
    }

    #[test]
    fn exposes_backend_version() {
        assert_eq!(mls_backend_version(), MLS_BACKEND_VERSION.to_owned());
    }

    #[test]
    fn reports_not_ready() {
        assert!(!mls_backend_ready());
    }

    #[test]
    fn exposes_backend_notice() {
        assert_eq!(mls_backend_notice(), MLS_BACKEND_NOTICE.to_owned());
    }
}
