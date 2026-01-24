//! MLS WASM bindings for Rapid encrypted chat
//!
//! This crate provides WASM bindings for OpenMLS to enable client-side
//! MLS (RFC 9420) encryption for multi-user chat.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use openmls::prelude::*;
use openmls::prelude::tls_codec::{Deserialize as TlsDeserialize, Serialize as TlsSerialize};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

// Initialize panic hook for better error messages in browser console
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// MLS ciphersuite to use (X25519, AES-128-GCM, SHA-256)
const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

/// Result type returned to JavaScript
#[derive(Serialize, Deserialize)]
pub struct JsResult<T> {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl<T> JsResult<T> {
    fn ok(value: T) -> Self {
        JsResult {
            ok: true,
            value: Some(value),
            error: None,
        }
    }

    fn err(error: String) -> Self {
        JsResult {
            ok: false,
            value: None,
            error: Some(error),
        }
    }
}

/// KeyPackage data to return to JavaScript
#[derive(Serialize, Deserialize)]
pub struct KeyPackageData {
    pub id: String,
    pub data: String, // Base64-encoded
}

/// Group creation result
#[derive(Serialize, Deserialize)]
pub struct GroupCreatedData {
    pub group_id: String, // Internal UUID
    pub mls_group_id: String, // Base64-encoded MLS group ID
}

/// Welcome message for adding a new member
#[derive(Serialize, Deserialize)]
pub struct WelcomeData {
    pub key_package_ref: String,
    pub welcome: String, // Base64-encoded
}

/// Add members result
#[derive(Serialize, Deserialize)]
pub struct AddMembersResult {
    pub commit: String, // Base64-encoded
    pub welcomes: Vec<WelcomeData>,
}

/// Encrypted message result
#[derive(Serialize, Deserialize)]
pub struct EncryptedMessage {
    pub ciphertext: String, // Base64-encoded
    pub epoch: u64,
}

/// Decrypted message result
#[derive(Serialize, Deserialize)]
pub struct DecryptedMessage {
    pub plaintext: String,
    pub sender_index: u32,
}

/// Exported state for persistence
#[derive(Serialize, Deserialize)]
pub struct ExportedState {
    pub credential: String,     // Base64-encoded credential
    pub signature_key: String,  // Base64-encoded signature key pair
    pub groups: Vec<ExportedGroup>,
}

#[derive(Serialize, Deserialize)]
pub struct ExportedGroup {
    pub id: String,
    pub mls_group_id: String,
    pub state: String, // Base64-encoded serialized group
}

/// The main MLS client that manages credentials and groups
#[wasm_bindgen]
pub struct MlsClient {
    crypto: OpenMlsRustCrypto,
    credential_with_key: CredentialWithKey,
    signature_keys: SignatureKeyPair,
    groups: HashMap<String, MlsGroup>,
}

#[wasm_bindgen]
impl MlsClient {
    /// Create a new MLS client with a fresh identity
    #[wasm_bindgen(constructor)]
    pub fn new(user_id: &str) -> Result<MlsClient, JsValue> {
        let crypto = OpenMlsRustCrypto::default();

        // Generate signature key pair
        let signature_keys = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm())
            .map_err(|e| JsValue::from_str(&format!("Failed to generate signature keys: {}", e)))?;

        // Create basic credential with user ID
        let credential = BasicCredential::new(user_id.as_bytes().to_vec());
        let credential_with_key = CredentialWithKey {
            credential: credential.into(),
            signature_key: signature_keys.public().into(),
        };

        // Store the signature keys in the crypto provider
        signature_keys.store(crypto.storage())
            .map_err(|e| JsValue::from_str(&format!("Failed to store signature keys: {}", e)))?;

        Ok(MlsClient {
            crypto,
            credential_with_key,
            signature_keys,
            groups: HashMap::new(),
        })
    }

    /// Generate KeyPackages for distribution
    #[wasm_bindgen(js_name = generateKeyPackages)]
    pub fn generate_key_packages(&self, count: u32) -> Result<JsValue, JsValue> {
        let mut packages = Vec::new();

        for _ in 0..count {
            let key_package_bundle = KeyPackage::builder()
                .build(
                    CIPHERSUITE,
                    &self.crypto,
                    &self.signature_keys,
                    self.credential_with_key.clone(),
                )
                .map_err(|e| JsValue::from_str(&format!("Failed to create KeyPackage: {}", e)))?;

            let key_package = key_package_bundle.key_package();

            let serialized = key_package
                .tls_serialize_detached()
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize KeyPackage: {}", e)))?;

            let hash_ref = key_package.hash_ref(self.crypto.crypto())
                .map_err(|e| JsValue::from_str(&format!("Failed to get KeyPackage hash: {}", e)))?;

            packages.push(KeyPackageData {
                id: BASE64.encode(hash_ref.as_slice()),
                data: BASE64.encode(&serialized),
            });
        }

        let result = JsResult::ok(packages);
        serde_wasm_bindgen::to_value(&result)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Create a new MLS group
    #[wasm_bindgen(js_name = createGroup)]
    pub fn create_group(&mut self, _group_name: &str) -> Result<JsValue, JsValue> {
        let group_id = uuid::Uuid::new_v4().to_string();
        let mls_group_id = GroupId::from_slice(group_id.as_bytes());

        let mls_group_config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .build();

        let mls_group = MlsGroup::new_with_group_id(
            &self.crypto,
            &self.signature_keys,
            &mls_group_config,
            mls_group_id.clone(),
            self.credential_with_key.clone(),
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to create group: {}", e)))?;

        self.groups.insert(group_id.clone(), mls_group);

        let result = JsResult::ok(GroupCreatedData {
            group_id: group_id.clone(),
            mls_group_id: BASE64.encode(mls_group_id.as_slice()),
        });
        serde_wasm_bindgen::to_value(&result)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Join a group using a Welcome message
    #[wasm_bindgen(js_name = joinGroup)]
    pub fn join_group(&mut self, welcome_b64: &str) -> Result<JsValue, JsValue> {
        let welcome_bytes = BASE64.decode(welcome_b64)
            .map_err(|e| JsValue::from_str(&format!("Invalid base64 welcome: {}", e)))?;

        let mls_message = MlsMessageIn::tls_deserialize(&mut welcome_bytes.as_slice())
            .map_err(|e| JsValue::from_str(&format!("Failed to deserialize welcome: {}", e)))?;

        let welcome = match mls_message.extract() {
            MlsMessageBodyIn::Welcome(w) => w,
            _ => return Err(JsValue::from_str("Message is not a Welcome")),
        };

        let mls_group_config = MlsGroupJoinConfig::builder()
            .build();

        let mls_group = StagedWelcome::new_from_welcome(
            &self.crypto,
            &mls_group_config,
            welcome,
            None, // No ratchet tree extension
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to process welcome: {}", e)))?
        .into_group(&self.crypto)
        .map_err(|e| JsValue::from_str(&format!("Failed to join group: {}", e)))?;

        let group_id = String::from_utf8_lossy(mls_group.group_id().as_slice()).to_string();
        let mls_group_id = BASE64.encode(mls_group.group_id().as_slice());

        self.groups.insert(group_id.clone(), mls_group);

        let result = JsResult::ok(GroupCreatedData {
            group_id,
            mls_group_id,
        });
        serde_wasm_bindgen::to_value(&result)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Add members to a group using their KeyPackages
    #[wasm_bindgen(js_name = addMembers)]
    pub fn add_members(&mut self, group_id: &str, key_packages_b64: Vec<String>) -> Result<JsValue, JsValue> {
        let group = self.groups.get_mut(group_id)
            .ok_or_else(|| JsValue::from_str("Group not found"))?;

        let mut key_packages = Vec::new();
        for kp_b64 in key_packages_b64 {
            let kp_bytes = BASE64.decode(&kp_b64)
                .map_err(|e| JsValue::from_str(&format!("Invalid base64 KeyPackage: {}", e)))?;
            let kp_in = KeyPackageIn::tls_deserialize(&mut kp_bytes.as_slice())
                .map_err(|e| JsValue::from_str(&format!("Failed to deserialize KeyPackage: {}", e)))?;
            let kp = kp_in.validate(self.crypto.crypto(), ProtocolVersion::Mls10)
                .map_err(|e| JsValue::from_str(&format!("Invalid KeyPackage: {:?}", e)))?;
            key_packages.push(kp);
        }

        let (commit, welcome, _group_info) = group.add_members(
            &self.crypto,
            &self.signature_keys,
            &key_packages,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to add members: {}", e)))?;

        // Merge the pending commit
        group.merge_pending_commit(&self.crypto)
            .map_err(|e| JsValue::from_str(&format!("Failed to merge commit: {}", e)))?;

        let commit_bytes = commit.tls_serialize_detached()
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize commit: {}", e)))?;

        let welcome_bytes = welcome.tls_serialize_detached()
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize welcome: {}", e)))?;

        // For simplicity, we return a single welcome for all added members
        // In production, you'd want to track which welcome goes to which member
        let welcomes = vec![WelcomeData {
            key_package_ref: "all".to_string(),
            welcome: BASE64.encode(&welcome_bytes),
        }];

        let result = JsResult::ok(AddMembersResult {
            commit: BASE64.encode(&commit_bytes),
            welcomes,
        });
        serde_wasm_bindgen::to_value(&result)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Encrypt a message for a group
    #[wasm_bindgen]
    pub fn encrypt(&mut self, group_id: &str, plaintext: &str) -> Result<JsValue, JsValue> {
        let group = self.groups.get_mut(group_id)
            .ok_or_else(|| JsValue::from_str("Group not found"))?;

        let ciphertext = group.create_message(
            &self.crypto,
            &self.signature_keys,
            plaintext.as_bytes(),
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to encrypt: {}", e)))?;

        let ciphertext_bytes = ciphertext.tls_serialize_detached()
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize ciphertext: {}", e)))?;

        let epoch = group.epoch().as_u64();

        let result = JsResult::ok(EncryptedMessage {
            ciphertext: BASE64.encode(&ciphertext_bytes),
            epoch,
        });
        serde_wasm_bindgen::to_value(&result)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Decrypt a message from a group
    #[wasm_bindgen]
    pub fn decrypt(&mut self, group_id: &str, ciphertext_b64: &str) -> Result<JsValue, JsValue> {
        let group = self.groups.get_mut(group_id)
            .ok_or_else(|| JsValue::from_str("Group not found"))?;

        let ciphertext_bytes = BASE64.decode(ciphertext_b64)
            .map_err(|e| JsValue::from_str(&format!("Invalid base64 ciphertext: {}", e)))?;

        let mls_message = MlsMessageIn::tls_deserialize(&mut ciphertext_bytes.as_slice())
            .map_err(|e| JsValue::from_str(&format!("Failed to deserialize message: {}", e)))?;

        let protocol_message = mls_message.try_into_protocol_message()
            .map_err(|e| JsValue::from_str(&format!("Not a protocol message: {:?}", e)))?;

        let processed = group.process_message(&self.crypto, protocol_message)
            .map_err(|e| JsValue::from_str(&format!("Failed to process message: {}", e)))?;

        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(app_msg) => {
                let plaintext = String::from_utf8(app_msg.into_bytes())
                    .map_err(|e| JsValue::from_str(&format!("Invalid UTF-8 in message: {}", e)))?;

                let result = JsResult::ok(DecryptedMessage {
                    plaintext,
                    sender_index: 0, // Would need to extract from sender
                });
                serde_wasm_bindgen::to_value(&result)
                    .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
            }
            ProcessedMessageContent::ProposalMessage(_) => {
                Err(JsValue::from_str("Received proposal, not application message"))
            }
            ProcessedMessageContent::StagedCommitMessage(staged_commit) => {
                // Process the commit - this updates group state but has no content
                group.merge_staged_commit(&self.crypto, *staged_commit)
                    .map_err(|e| JsValue::from_str(&format!("Failed to merge commit: {}", e)))?;

                // Return success with no value to indicate commit was processed
                let result: JsResult<DecryptedMessage> = JsResult {
                    ok: true,
                    value: None,
                    error: None,
                };
                serde_wasm_bindgen::to_value(&result)
                    .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
            }
            ProcessedMessageContent::ExternalJoinProposalMessage(_) => {
                Err(JsValue::from_str("Received external join proposal"))
            }
        }
    }

    /// Get the current epoch of a group
    #[wasm_bindgen(js_name = getEpoch)]
    pub fn get_epoch(&self, group_id: &str) -> Result<u64, JsValue> {
        let group = self.groups.get(group_id)
            .ok_or_else(|| JsValue::from_str("Group not found"))?;
        Ok(group.epoch().as_u64())
    }

    /// Export client state for persistence
    /// Note: This exports the ratchet tree for group state. Full MlsGroup serialization
    /// requires the OpenMLS serde feature which has compatibility considerations.
    /// For production, consider using OpenMLS's built-in persistence mechanisms.
    #[wasm_bindgen(js_name = exportState)]
    pub fn export_state(&self) -> Result<JsValue, JsValue> {
        let credential_bytes = self.credential_with_key.credential.serialized_content();
        let signature_key_bytes = self.signature_keys.to_public_vec();

        let mut exported_groups = Vec::new();
        for (id, group) in &self.groups {
            let group_bytes = group.export_ratchet_tree()
                .tls_serialize_detached()
                .map_err(|e| JsValue::from_str(&format!("Failed to export group: {}", e)))?;

            exported_groups.push(ExportedGroup {
                id: id.clone(),
                mls_group_id: BASE64.encode(group.group_id().as_slice()),
                state: BASE64.encode(&group_bytes),
            });
        }

        let state = ExportedState {
            credential: BASE64.encode(credential_bytes),
            signature_key: BASE64.encode(&signature_key_bytes),
            groups: exported_groups,
        };

        let result = JsResult::ok(state);
        serde_wasm_bindgen::to_value(&result)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}
