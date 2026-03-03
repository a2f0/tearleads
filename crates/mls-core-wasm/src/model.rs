use serde::{Deserialize, Serialize};

/// MLS state schema version.
pub const MLS_STATE_VERSION: u8 = 1;

/// Key package schema version.
pub const MLS_KEY_PACKAGE_VERSION: u8 = 1;

/// Commit message schema version.
pub const MLS_COMMIT_VERSION: u8 = 1;

/// Welcome message schema version.
pub const MLS_WELCOME_VERSION: u8 = 1;

/// Application message schema version.
pub const MLS_APP_MESSAGE_VERSION: u8 = 1;

/// Ciphersuite identifier for MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519.
pub const MLS_CIPHERSUITE_ID: u16 = 0x0003;

/// Stored credential bundle data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CredentialBundleData {
    /// Schema version.
    pub version: u8,
    /// User identifier.
    pub user_id: String,
    /// Ed25519 public key bytes.
    pub signing_public_key: Vec<u8>,
    /// Creation timestamp in milliseconds.
    pub created_at_ms: u64,
}

/// Key package payload without signature.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnsignedKeyPackageData {
    /// Schema version.
    pub version: u8,
    /// User identifier.
    pub user_id: String,
    /// Ed25519 public key bytes.
    pub signing_public_key: Vec<u8>,
    /// X25519 HPKE public key bytes.
    pub hpke_public_key: Vec<u8>,
    /// Creation timestamp in milliseconds.
    pub created_at_ms: u64,
}

/// Signed key package payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyPackageData {
    /// Schema version.
    pub version: u8,
    /// User identifier.
    pub user_id: String,
    /// Ed25519 public key bytes.
    pub signing_public_key: Vec<u8>,
    /// X25519 HPKE public key bytes.
    pub hpke_public_key: Vec<u8>,
    /// Creation timestamp in milliseconds.
    pub created_at_ms: u64,
    /// Ed25519 signature over [`UnsignedKeyPackageData`].
    pub signature: Vec<u8>,
}

/// Group member entry in serialized state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupMemberData {
    /// User identifier.
    pub user_id: String,
    /// Leaf index in the logical member list.
    pub leaf_index: u32,
    /// Ed25519 public key bytes.
    pub signing_public_key: Vec<u8>,
    /// X25519 HPKE public key bytes.
    pub hpke_public_key: Vec<u8>,
}

/// Epoch secret entry in serialized state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EpochSecretData {
    /// Epoch number.
    pub epoch: u64,
    /// Epoch secret bytes.
    pub secret: Vec<u8>,
}

/// Persisted group state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupStateData {
    /// Schema version.
    pub version: u8,
    /// Group identifier.
    pub group_id: String,
    /// Current epoch.
    pub epoch: u64,
    /// Ciphersuite identifier.
    pub ciphersuite: u16,
    /// Local user identifier.
    pub self_user_id: String,
    /// Local Ed25519 private key bytes.
    pub self_signing_private_key: Vec<u8>,
    /// Local Ed25519 public key bytes.
    pub self_signing_public_key: Vec<u8>,
    /// Active group members.
    pub members: Vec<GroupMemberData>,
    /// Epoch secret history.
    pub epoch_secrets: Vec<EpochSecretData>,
}

/// Commit operation details.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CommitOperationData {
    /// Add a new member.
    Add {
        /// Added member descriptor.
        member: GroupMemberData,
    },
    /// Remove an existing member.
    Remove {
        /// Removed leaf index.
        leaf_index: u32,
    },
}

/// Commit payload without signature.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnsignedCommitData {
    /// Schema version.
    pub version: u8,
    /// Group identifier.
    pub group_id: String,
    /// Previous epoch.
    pub previous_epoch: u64,
    /// New epoch.
    pub new_epoch: u64,
    /// Proposer leaf index.
    pub proposer_leaf_index: u32,
    /// Commit operation.
    pub operation: CommitOperationData,
}

/// Signed commit payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitData {
    /// Schema version.
    pub version: u8,
    /// Group identifier.
    pub group_id: String,
    /// Previous epoch.
    pub previous_epoch: u64,
    /// New epoch.
    pub new_epoch: u64,
    /// Proposer leaf index.
    pub proposer_leaf_index: u32,
    /// Commit operation.
    pub operation: CommitOperationData,
    /// Ed25519 signature over [`UnsignedCommitData`].
    pub signature: Vec<u8>,
}

/// Encrypted welcome payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WelcomeEncryptedData {
    /// Group identifier.
    pub group_id: String,
    /// Joined epoch.
    pub epoch: u64,
    /// Epoch secret bytes for the joined epoch.
    pub epoch_secret: Vec<u8>,
    /// Active members at the joined epoch.
    pub members: Vec<GroupMemberData>,
    /// Ciphersuite identifier.
    pub ciphersuite: u16,
}

/// Welcome payload without signature.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnsignedWelcomeData {
    /// Schema version.
    pub version: u8,
    /// Group identifier.
    pub group_id: String,
    /// Joined epoch.
    pub epoch: u64,
    /// Key package reference selected for this welcome.
    pub key_package_ref: String,
    /// Leaf index of the inviter.
    pub inviter_leaf_index: u32,
    /// Leaf index of the signer.
    pub signer_leaf_index: u32,
    /// Ephemeral X25519 public key bytes.
    pub ephemeral_public_key: Vec<u8>,
    /// AEAD nonce bytes.
    pub nonce: Vec<u8>,
    /// AEAD ciphertext bytes.
    pub ciphertext: Vec<u8>,
}

/// Signed welcome payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WelcomeData {
    /// Schema version.
    pub version: u8,
    /// Group identifier.
    pub group_id: String,
    /// Joined epoch.
    pub epoch: u64,
    /// Key package reference selected for this welcome.
    pub key_package_ref: String,
    /// Leaf index of the inviter.
    pub inviter_leaf_index: u32,
    /// Leaf index of the signer.
    pub signer_leaf_index: u32,
    /// Ephemeral X25519 public key bytes.
    pub ephemeral_public_key: Vec<u8>,
    /// AEAD nonce bytes.
    pub nonce: Vec<u8>,
    /// AEAD ciphertext bytes.
    pub ciphertext: Vec<u8>,
    /// Ed25519 signature over [`UnsignedWelcomeData`].
    pub signature: Vec<u8>,
}

/// Application message payload without signature.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnsignedAppMessageData {
    /// Schema version.
    pub version: u8,
    /// Group identifier.
    pub group_id: String,
    /// Epoch.
    pub epoch: u64,
    /// Sender leaf index.
    pub sender_leaf_index: u32,
    /// AEAD nonce bytes.
    pub nonce: Vec<u8>,
    /// AEAD ciphertext bytes.
    pub ciphertext: Vec<u8>,
}

/// Signed application message payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppMessageData {
    /// Schema version.
    pub version: u8,
    /// Group identifier.
    pub group_id: String,
    /// Epoch.
    pub epoch: u64,
    /// Sender leaf index.
    pub sender_leaf_index: u32,
    /// AEAD nonce bytes.
    pub nonce: Vec<u8>,
    /// AEAD ciphertext bytes.
    pub ciphertext: Vec<u8>,
    /// Ed25519 signature over [`UnsignedAppMessageData`].
    pub signature: Vec<u8>,
}

/// Metadata-only member entry for JavaScript consumers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupMemberMetadataOutput {
    /// User identifier.
    pub user_id: String,
    /// Leaf index.
    pub leaf_index: u32,
}

/// Group state metadata for JavaScript consumers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupStateMetadataOutput {
    /// Group identifier.
    pub group_id: String,
    /// Current epoch.
    pub epoch: u64,
    /// Local user identifier.
    pub self_user_id: String,
    /// Active members.
    pub members: Vec<GroupMemberMetadataOutput>,
}

/// Credential generation output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GeneratedCredentialOutput {
    /// Serialized credential bundle bytes.
    pub credential_bundle: Vec<u8>,
    /// Ed25519 private key bytes.
    pub private_key: Vec<u8>,
    /// Creation timestamp in milliseconds.
    pub created_at_ms: u64,
}

/// Key package generation output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GeneratedKeyPackageOutput {
    /// Serialized key package bytes.
    pub key_package: Vec<u8>,
    /// Key package reference (hex SHA-256).
    pub key_package_ref: String,
    /// X25519 private key bytes.
    pub private_key: Vec<u8>,
    /// Creation timestamp in milliseconds.
    pub created_at_ms: u64,
}

/// Add-member output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AddMemberOutput {
    /// Updated serialized group state bytes.
    pub state: Vec<u8>,
    /// Serialized commit bytes.
    pub commit: Vec<u8>,
    /// Serialized welcome bytes.
    pub welcome: Vec<u8>,
    /// Group info bytes.
    pub group_info: Vec<u8>,
    /// New epoch.
    pub new_epoch: u64,
}

/// Remove-member output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoveMemberOutput {
    /// Updated serialized group state bytes.
    pub state: Vec<u8>,
    /// Serialized commit bytes.
    pub commit: Vec<u8>,
    /// New epoch.
    pub new_epoch: u64,
}

/// Decrypted message output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecryptOutput {
    /// Authenticated sender user identifier.
    pub sender_id: String,
    /// Decrypted plaintext bytes.
    pub plaintext: Vec<u8>,
    /// Authenticated metadata bytes.
    pub authenticated_data: Vec<u8>,
}

/// Group state import output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportStateOutput {
    /// Normalized serialized state bytes.
    pub state: Vec<u8>,
    /// Current epoch in the imported state.
    pub epoch: u64,
}
