use std::{
    collections::{BTreeSet, HashSet},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::{
    crypto::{
        generate_x25519_key_pair, random_bytes, require_key_bytes, sha256, sign_bytes,
        signing_key_from_private, verify_signature,
    },
    error::MlsError,
    model::{
        CredentialBundleData, EpochSecretData, GeneratedCredentialOutput,
        GeneratedKeyPackageOutput, GroupMemberData, GroupMemberMetadataOutput, GroupStateData,
        GroupStateMetadataOutput, ImportStateOutput, KeyPackageData, MLS_CIPHERSUITE_ID,
        MLS_KEY_PACKAGE_VERSION, MLS_STATE_VERSION, UnsignedKeyPackageData,
    },
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct AeadMetadata {
    group_id: String,
    epoch: u64,
    sender_leaf_index: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct WelcomeAeadMetadata {
    pub(crate) group_id: String,
    pub(crate) epoch: u64,
    pub(crate) key_package_ref: String,
    pub(crate) inviter_leaf_index: u32,
    pub(crate) signer_leaf_index: u32,
    pub(crate) ephemeral_public_key: Vec<u8>,
}

pub(crate) fn now_ms() -> Result<u64, MlsError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| MlsError::Crypto(format!("system clock is before UNIX epoch: {error}")))?;

    Ok(duration.as_millis() as u64)
}

pub(crate) fn serialize_json<T: Serialize>(value: &T) -> Result<Vec<u8>, MlsError> {
    serde_json::to_vec(value)
        .map_err(|error| MlsError::Serialization(format!("JSON serialization failed: {error}")))
}

pub(crate) fn deserialize_json<T: DeserializeOwned>(
    bytes: &[u8],
    context: &str,
) -> Result<T, MlsError> {
    serde_json::from_slice(bytes)
        .map_err(|error| MlsError::Serialization(format!("invalid {context} payload: {error}")))
}

pub(crate) fn ensure_non_empty(value: &str, field: &str) -> Result<(), MlsError> {
    if value.trim().is_empty() {
        return Err(MlsError::InvalidInput(format!("{field} is required")));
    }
    Ok(())
}

fn validate_member(member: &GroupMemberData) -> Result<(), MlsError> {
    ensure_non_empty(&member.user_id, "member.user_id")?;
    require_key_bytes::<32>(&member.signing_public_key, "member.signing_public_key")?;

    if !member.hpke_public_key.is_empty() {
        require_key_bytes::<32>(&member.hpke_public_key, "member.hpke_public_key")?;
    }

    Ok(())
}

fn ensure_unique_members(members: &[GroupMemberData]) -> Result<(), MlsError> {
    if members.is_empty() {
        return Err(MlsError::InvalidState(
            "group state must contain at least one member".to_owned(),
        ));
    }

    let mut leaf_indexes = BTreeSet::new();
    let mut user_ids = HashSet::new();

    for member in members {
        validate_member(member)?;
        if !leaf_indexes.insert(member.leaf_index) {
            return Err(MlsError::InvalidState(format!(
                "duplicate leaf index {} in members",
                member.leaf_index
            )));
        }

        if !user_ids.insert(member.user_id.clone()) {
            return Err(MlsError::InvalidState(format!(
                "duplicate user id {} in members",
                member.user_id
            )));
        }
    }

    Ok(())
}

pub(crate) fn verify_credential(
    credential_bundle_bytes: &[u8],
    credential_private_key_bytes: &[u8],
) -> Result<CredentialBundleData, MlsError> {
    let credential: CredentialBundleData =
        deserialize_json(credential_bundle_bytes, "credential bundle")?;

    if credential.version != MLS_KEY_PACKAGE_VERSION {
        return Err(MlsError::InvalidInput(format!(
            "unsupported credential version {}",
            credential.version
        )));
    }

    ensure_non_empty(&credential.user_id, "credential.user_id")?;

    let signing_key = signing_key_from_private(credential_private_key_bytes)?;
    if signing_key.verifying_key().to_bytes().as_slice() != credential.signing_public_key {
        return Err(MlsError::Crypto(
            "credential private key does not match bundle public key".to_owned(),
        ));
    }

    Ok(credential)
}

pub(crate) fn decode_key_package(key_package_bytes: &[u8]) -> Result<KeyPackageData, MlsError> {
    let key_package: KeyPackageData = deserialize_json(key_package_bytes, "key package")?;

    if key_package.version != MLS_KEY_PACKAGE_VERSION {
        return Err(MlsError::InvalidInput(format!(
            "unsupported key package version {}",
            key_package.version
        )));
    }

    ensure_non_empty(&key_package.user_id, "key_package.user_id")?;
    require_key_bytes::<32>(
        &key_package.signing_public_key,
        "key_package.signing_public_key",
    )?;
    require_key_bytes::<32>(&key_package.hpke_public_key, "key_package.hpke_public_key")?;

    let unsigned = UnsignedKeyPackageData {
        version: key_package.version,
        user_id: key_package.user_id.clone(),
        signing_public_key: key_package.signing_public_key.clone(),
        hpke_public_key: key_package.hpke_public_key.clone(),
        created_at_ms: key_package.created_at_ms,
    };
    let unsigned_bytes = serialize_json(&unsigned)?;

    verify_signature(
        &key_package.signing_public_key,
        &unsigned_bytes,
        &key_package.signature,
    )?;

    Ok(key_package)
}

fn normalize_state(mut state: GroupStateData) -> Result<GroupStateData, MlsError> {
    if state.version != MLS_STATE_VERSION {
        return Err(MlsError::InvalidState(format!(
            "unsupported group state version {}",
            state.version
        )));
    }

    ensure_non_empty(&state.group_id, "group_state.group_id")?;
    ensure_non_empty(&state.self_user_id, "group_state.self_user_id")?;

    if state.ciphersuite != MLS_CIPHERSUITE_ID {
        return Err(MlsError::InvalidState(format!(
            "unsupported ciphersuite {}",
            state.ciphersuite
        )));
    }

    require_key_bytes::<32>(
        &state.self_signing_private_key,
        "group_state.self_signing_private_key",
    )?;
    require_key_bytes::<32>(
        &state.self_signing_public_key,
        "group_state.self_signing_public_key",
    )?;

    let signing_key = signing_key_from_private(&state.self_signing_private_key)?;
    if signing_key.verifying_key().to_bytes().as_slice() != state.self_signing_public_key {
        return Err(MlsError::InvalidState(
            "group state self signing key pair does not match".to_owned(),
        ));
    }

    ensure_unique_members(&state.members)?;

    let self_member = state
        .members
        .iter()
        .find(|member| member.user_id == state.self_user_id);
    let Some(self_member) = self_member else {
        return Err(MlsError::InvalidState(
            "group state self user is not in members list".to_owned(),
        ));
    };

    if self_member.signing_public_key != state.self_signing_public_key {
        return Err(MlsError::InvalidState(
            "group state self member public key does not match local key".to_owned(),
        ));
    }

    if state.epoch_secrets.is_empty() {
        return Err(MlsError::InvalidState(
            "group state must include at least one epoch secret".to_owned(),
        ));
    }

    let mut secret_epochs = BTreeSet::new();
    for entry in &state.epoch_secrets {
        require_key_bytes::<32>(&entry.secret, "epoch_secret")?;
        if !secret_epochs.insert(entry.epoch) {
            return Err(MlsError::InvalidState(format!(
                "duplicate epoch secret for epoch {}",
                entry.epoch
            )));
        }
    }

    if !secret_epochs.contains(&state.epoch) {
        return Err(MlsError::InvalidState(format!(
            "missing epoch secret for current epoch {}",
            state.epoch
        )));
    }

    state.members.sort_by_key(|member| member.leaf_index);
    state.epoch_secrets.sort_by_key(|entry| entry.epoch);

    Ok(state)
}

pub(crate) fn decode_group_state(group_state_bytes: &[u8]) -> Result<GroupStateData, MlsError> {
    let state: GroupStateData = deserialize_json(group_state_bytes, "group state")?;
    normalize_state(state)
}

pub(crate) fn encode_group_state(state: &GroupStateData) -> Result<Vec<u8>, MlsError> {
    let normalized = normalize_state(state.clone())?;
    serialize_json(&normalized)
}

pub(crate) fn current_epoch_secret(state: &GroupStateData) -> Result<Vec<u8>, MlsError> {
    state
        .epoch_secrets
        .iter()
        .find(|entry| entry.epoch == state.epoch)
        .map(|entry| entry.secret.clone())
        .ok_or_else(|| {
            MlsError::NotFound(format!("missing epoch secret for epoch {}", state.epoch))
        })
}

pub(crate) fn epoch_secret_for(
    epoch_secrets: &[EpochSecretData],
    epoch: u64,
) -> Result<Vec<u8>, MlsError> {
    epoch_secrets
        .iter()
        .find(|entry| entry.epoch == epoch)
        .map(|entry| entry.secret.clone())
        .ok_or_else(|| MlsError::NotFound(format!("missing epoch secret for epoch {epoch}")))
}

pub(crate) fn self_leaf_index(state: &GroupStateData) -> Result<u32, MlsError> {
    state
        .members
        .iter()
        .find(|member| member.user_id == state.self_user_id)
        .map(|member| member.leaf_index)
        .ok_or_else(|| MlsError::NotFound("local member not found in state".to_owned()))
}

pub(crate) fn add_epoch_secret(state: &mut GroupStateData, epoch: u64, secret: Vec<u8>) {
    state.epoch_secrets.push(EpochSecretData { epoch, secret });
    state.epoch_secrets.sort_by_key(|entry| entry.epoch);

    const MAX_EPOCH_SECRETS: usize = 64;
    if state.epoch_secrets.len() > MAX_EPOCH_SECRETS {
        let remove_count = state.epoch_secrets.len() - MAX_EPOCH_SECRETS;
        state.epoch_secrets.drain(0..remove_count);
    }
}

pub(crate) fn group_state_metadata(
    group_state_bytes: &[u8],
) -> Result<GroupStateMetadataOutput, MlsError> {
    let state = decode_group_state(group_state_bytes)?;
    let members = state
        .members
        .iter()
        .map(|member| GroupMemberMetadataOutput {
            user_id: member.user_id.clone(),
            leaf_index: member.leaf_index,
        })
        .collect();

    Ok(GroupStateMetadataOutput {
        group_id: state.group_id,
        epoch: state.epoch,
        self_user_id: state.self_user_id,
        members,
    })
}

pub(crate) fn generate_credential(user_id: &str) -> Result<GeneratedCredentialOutput, MlsError> {
    ensure_non_empty(user_id, "user_id")?;

    let private_key = random_bytes::<32>()?.to_vec();
    let signing_key = signing_key_from_private(&private_key)?;
    let created_at_ms = now_ms()?;

    let credential_bundle = CredentialBundleData {
        version: MLS_KEY_PACKAGE_VERSION,
        user_id: user_id.trim().to_owned(),
        signing_public_key: signing_key.verifying_key().to_bytes().to_vec(),
        created_at_ms,
    };

    Ok(GeneratedCredentialOutput {
        credential_bundle: serialize_json(&credential_bundle)?,
        private_key,
        created_at_ms,
    })
}

pub(crate) fn generate_key_package(
    credential_bundle_bytes: &[u8],
    credential_private_key_bytes: &[u8],
) -> Result<GeneratedKeyPackageOutput, MlsError> {
    let credential = verify_credential(credential_bundle_bytes, credential_private_key_bytes)?;
    let created_at_ms = now_ms()?;
    let (hpke_private_key, hpke_public_key) = generate_x25519_key_pair()?;

    let unsigned = UnsignedKeyPackageData {
        version: MLS_KEY_PACKAGE_VERSION,
        user_id: credential.user_id,
        signing_public_key: credential.signing_public_key,
        hpke_public_key,
        created_at_ms,
    };

    let unsigned_bytes = serialize_json(&unsigned)?;
    let signature = sign_bytes(credential_private_key_bytes, &unsigned_bytes)?;

    let key_package = KeyPackageData {
        version: unsigned.version,
        user_id: unsigned.user_id,
        signing_public_key: unsigned.signing_public_key,
        hpke_public_key: unsigned.hpke_public_key,
        created_at_ms: unsigned.created_at_ms,
        signature,
    };

    let key_package_bytes = serialize_json(&key_package)?;
    let key_package_ref = hex::encode(sha256(&key_package_bytes));

    Ok(GeneratedKeyPackageOutput {
        key_package: key_package_bytes,
        key_package_ref,
        private_key: hpke_private_key,
        created_at_ms,
    })
}

pub(crate) fn create_group(
    group_id: &str,
    credential_bundle_bytes: &[u8],
    credential_private_key_bytes: &[u8],
) -> Result<Vec<u8>, MlsError> {
    ensure_non_empty(group_id, "group_id")?;
    let credential = verify_credential(credential_bundle_bytes, credential_private_key_bytes)?;

    let epoch_secret = random_bytes::<32>()?.to_vec();

    let state = GroupStateData {
        version: MLS_STATE_VERSION,
        group_id: group_id.trim().to_owned(),
        epoch: 0,
        ciphersuite: MLS_CIPHERSUITE_ID,
        self_user_id: credential.user_id.clone(),
        self_signing_private_key: credential_private_key_bytes.to_vec(),
        self_signing_public_key: credential.signing_public_key.clone(),
        members: vec![GroupMemberData {
            user_id: credential.user_id,
            leaf_index: 0,
            signing_public_key: credential.signing_public_key,
            hpke_public_key: Vec::new(),
        }],
        epoch_secrets: vec![EpochSecretData {
            epoch: 0,
            secret: epoch_secret,
        }],
    };

    encode_group_state(&state)
}

pub(crate) fn export_group_state(group_state_bytes: &[u8]) -> Result<Vec<u8>, MlsError> {
    let state = decode_group_state(group_state_bytes)?;
    encode_group_state(&state)
}

pub(crate) fn import_group_state(
    group_id: &str,
    group_state_bytes: &[u8],
) -> Result<ImportStateOutput, MlsError> {
    ensure_non_empty(group_id, "group_id")?;
    let state = decode_group_state(group_state_bytes)?;

    if state.group_id != group_id.trim() {
        return Err(MlsError::InvalidState(format!(
            "group state id mismatch: expected {}, got {}",
            group_id.trim(),
            state.group_id
        )));
    }

    Ok(ImportStateOutput {
        state: encode_group_state(&state)?,
        epoch: state.epoch,
    })
}

pub(crate) fn metadata_bytes(
    group_id: &str,
    epoch: u64,
    sender_leaf_index: u32,
) -> Result<Vec<u8>, MlsError> {
    serialize_json(&AeadMetadata {
        group_id: group_id.to_owned(),
        epoch,
        sender_leaf_index,
    })
}

pub(crate) fn welcome_metadata_bytes(metadata: &WelcomeAeadMetadata) -> Result<Vec<u8>, MlsError> {
    serialize_json(metadata)
}
