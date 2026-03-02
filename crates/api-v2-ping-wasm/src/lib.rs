//! WASM bindings for API v2 ping response validation.

use serde::{Deserialize, Serialize};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

/// Canonical v2 ping endpoint path.
pub const V2_PING_PATH: &str = "/v2/ping";

/// API v2 ping response payload.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct PingData {
    /// Service health status.
    pub status: String,
    /// Service identifier.
    pub service: String,
    /// API version string.
    pub version: String,
}

fn parse_v2_ping_json_inner(payload_json: &str) -> Result<PingData, String> {
    let payload: PingData = serde_json::from_str(payload_json)
        .map_err(|error| format!("invalid v2 ping payload JSON: {error}"))?;
    validate_payload(&payload)?;
    Ok(payload)
}

fn validate_payload(payload: &PingData) -> Result<(), String> {
    if payload.status != "ok" {
        return Err("invalid v2 ping status".to_owned());
    }

    if payload.service != "api-v2" {
        return Err("invalid v2 ping service".to_owned());
    }

    if payload.version.trim().is_empty() {
        return Err("invalid v2 ping version".to_owned());
    }

    Ok(())
}

/// Returns the canonical v2 ping path.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn v2_ping_path() -> String {
    V2_PING_PATH.to_owned()
}

/// Parses and validates a JSON-encoded v2 ping payload.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn parse_v2_ping_json(payload_json: &str) -> Result<JsValue, JsValue> {
    fn js_error(error: String) -> JsValue {
        JsValue::from_str(&error)
    }

    let payload = parse_v2_ping_json_inner(payload_json).map_err(js_error)?;
    serde_wasm_bindgen::to_value(&payload)
        .map_err(|error| js_error(format!("failed to convert v2 ping payload: {error}")))
}

/// Parses and validates a JS-object v2 ping payload.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn parse_v2_ping_value(payload: JsValue) -> Result<JsValue, JsValue> {
    fn js_error(error: String) -> JsValue {
        JsValue::from_str(&error)
    }

    let payload: PingData = serde_wasm_bindgen::from_value(payload)
        .map_err(|error| js_error(format!("invalid v2 ping payload value: {error}")))?;
    validate_payload(&payload).map_err(js_error)?;
    serde_wasm_bindgen::to_value(&payload)
        .map_err(|error| js_error(format!("failed to convert v2 ping payload: {error}")))
}

#[cfg(test)]
mod tests {
    use super::{PingData, parse_v2_ping_json_inner, v2_ping_path};

    #[test]
    fn parses_valid_v2_ping_payload() {
        let parsed =
            parse_v2_ping_json_inner(r#"{"status":"ok","service":"api-v2","version":"1.2.3"}"#);

        assert_eq!(
            parsed,
            Ok(PingData {
                status: "ok".to_owned(),
                service: "api-v2".to_owned(),
                version: "1.2.3".to_owned(),
            })
        );
    }

    #[test]
    fn rejects_invalid_status() {
        let parsed =
            parse_v2_ping_json_inner(r#"{"status":"down","service":"api-v2","version":"1.2.3"}"#);
        assert_eq!(parsed, Err("invalid v2 ping status".to_owned()));
    }

    #[test]
    fn rejects_invalid_service() {
        let parsed =
            parse_v2_ping_json_inner(r#"{"status":"ok","service":"api-v1","version":"1.2.3"}"#);
        assert_eq!(parsed, Err("invalid v2 ping service".to_owned()));
    }

    #[test]
    fn rejects_empty_version() {
        let parsed =
            parse_v2_ping_json_inner(r#"{"status":"ok","service":"api-v2","version":"   "}"#);
        assert_eq!(parsed, Err("invalid v2 ping version".to_owned()));
    }

    #[test]
    fn rejects_invalid_json() {
        let parsed = parse_v2_ping_json_inner("not-json");
        assert!(parsed.is_err());
    }

    #[test]
    fn exposes_v2_ping_path() {
        assert_eq!(v2_ping_path(), "/v2/ping".to_owned());
    }
}
