//! Rust/WASM MLS primitives for `@tearleads/mls-core`.

mod crypto;
mod error;
mod messaging;
mod model;
mod operations;
mod protocol;

#[cfg(test)]
mod protocol_tests;

use error::MlsError;
use messaging::{decrypt_message, encrypt_message};
use model::{
    AddMemberOutput, DecryptOutput, GeneratedCredentialOutput, GeneratedKeyPackageOutput,
    GroupStateMetadataOutput, ImportStateOutput, RemoveMemberOutput,
};
use operations::{add_member, join_group, process_commit, remove_member};
use protocol::{
    create_group, export_group_state, generate_credential, generate_key_package,
    group_state_metadata, import_group_state,
};
use wasm_bindgen::JsValue;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::wasm_bindgen;

/// Stable Rust/WASM backend identifier for `mls-core`.
pub const MLS_BACKEND_NAME: &str = "tearleads-mls-core-wasm";

/// Current crate version exposed to JavaScript.
pub const MLS_BACKEND_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Runtime notice surfaced by the production-ready Rust MLS backend.
pub const MLS_BACKEND_NOTICE: &str =
    "Rust/WASM MLS backend is active with authenticated epoch and message primitives.";

fn to_js_error(error: MlsError) -> JsValue {
    JsValue::from_str(&error.to_string())
}

fn to_js_value<T: serde::Serialize>(value: &T) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(value)
        .map_err(|error| JsValue::from_str(&format!("failed to convert result to JS: {error}")))
}

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
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_backend_ready() -> bool {
    true
}

/// Returns an operator-facing backend readiness note.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_backend_notice() -> String {
    MLS_BACKEND_NOTICE.to_owned()
}

/// Generates an MLS credential bundle and signing key.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_generate_credential(user_id: &str) -> Result<JsValue, JsValue> {
    let credential: GeneratedCredentialOutput =
        generate_credential(user_id).map_err(to_js_error)?;
    to_js_value(&credential)
}

/// Generates a signed key package.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_generate_key_package(
    credential_bundle: &[u8],
    credential_private_key: &[u8],
) -> Result<JsValue, JsValue> {
    let key_package: GeneratedKeyPackageOutput =
        generate_key_package(credential_bundle, credential_private_key).map_err(to_js_error)?;
    to_js_value(&key_package)
}

/// Creates a new MLS group state.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_create_group(
    group_id: &str,
    credential_bundle: &[u8],
    credential_private_key: &[u8],
) -> Result<Vec<u8>, JsValue> {
    create_group(group_id, credential_bundle, credential_private_key).map_err(to_js_error)
}

/// Joins a group from a welcome payload and key package private key.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_join_group(
    group_id: &str,
    welcome_bytes: &[u8],
    key_package_ref: &str,
    key_package_private_key: &[u8],
    credential_bundle: &[u8],
    credential_private_key: &[u8],
) -> Result<Vec<u8>, JsValue> {
    join_group(
        group_id,
        welcome_bytes,
        key_package_ref,
        key_package_private_key,
        credential_bundle,
        credential_private_key,
    )
    .map_err(to_js_error)
}

/// Adds a member and returns commit/welcome plus updated state.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_add_member(group_state: &[u8], member_key_package: &[u8]) -> Result<JsValue, JsValue> {
    let output: AddMemberOutput =
        add_member(group_state, member_key_package).map_err(to_js_error)?;
    to_js_value(&output)
}

/// Removes a member and returns commit plus updated state.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_remove_member(group_state: &[u8], leaf_index: u32) -> Result<JsValue, JsValue> {
    let output: RemoveMemberOutput = remove_member(group_state, leaf_index).map_err(to_js_error)?;
    to_js_value(&output)
}

/// Processes a commit and returns updated state.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_process_commit(group_state: &[u8], commit_bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
    process_commit(group_state, commit_bytes).map_err(to_js_error)
}

/// Encrypts an application message with authenticated metadata.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_encrypt_message(group_state: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, JsValue> {
    encrypt_message(group_state, plaintext).map_err(to_js_error)
}

/// Decrypts an application message and returns authenticated sender identity.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_decrypt_message(group_state: &[u8], ciphertext: &[u8]) -> Result<JsValue, JsValue> {
    let output: DecryptOutput = decrypt_message(group_state, ciphertext).map_err(to_js_error)?;
    to_js_value(&output)
}

/// Returns metadata for a serialized group state.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_group_state_metadata(group_state: &[u8]) -> Result<JsValue, JsValue> {
    let metadata: GroupStateMetadataOutput =
        group_state_metadata(group_state).map_err(to_js_error)?;
    to_js_value(&metadata)
}

/// Exports normalized serialized group state.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_export_group_state(group_state: &[u8]) -> Result<Vec<u8>, JsValue> {
    export_group_state(group_state).map_err(to_js_error)
}

/// Imports and validates serialized group state.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_import_group_state(group_id: &str, group_state: &[u8]) -> Result<JsValue, JsValue> {
    let output: ImportStateOutput =
        import_group_state(group_id, group_state).map_err(to_js_error)?;
    to_js_value(&output)
}

/// Returns the current epoch encoded in a serialized group state.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn mls_group_epoch(group_state: &[u8]) -> Result<u64, JsValue> {
    let metadata = group_state_metadata(group_state).map_err(to_js_error)?;
    Ok(metadata.epoch)
}
