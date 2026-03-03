use crate::{
    crypto::{
        decrypt_chacha20, derive_epoch_secret, derive_welcome_key, encrypt_chacha20,
        generate_x25519_key_pair, random_nonce, require_key_bytes, sha256, sign_bytes,
        verify_signature, x25519_shared_secret,
    },
    error::MlsError,
    model::{
        AddMemberOutput, CommitData, CommitOperationData, GroupMemberData, MLS_CIPHERSUITE_ID,
        MLS_COMMIT_VERSION, MLS_WELCOME_VERSION, RemoveMemberOutput, UnsignedCommitData,
        UnsignedWelcomeData, WelcomeData, WelcomeEncryptedData,
    },
    protocol::{
        WelcomeAeadMetadata, add_epoch_secret, current_epoch_secret, decode_group_state,
        decode_key_package, encode_group_state, ensure_non_empty, self_leaf_index, serialize_json,
        verify_credential, welcome_metadata_bytes,
    },
};

pub(crate) fn join_group(
    group_id: &str,
    welcome_bytes: &[u8],
    key_package_ref: &str,
    key_package_private_key_bytes: &[u8],
    credential_bundle_bytes: &[u8],
    credential_private_key_bytes: &[u8],
) -> Result<Vec<u8>, MlsError> {
    ensure_non_empty(group_id, "group_id")?;
    ensure_non_empty(key_package_ref, "key_package_ref")?;

    let credential = verify_credential(credential_bundle_bytes, credential_private_key_bytes)?;
    require_key_bytes::<32>(key_package_private_key_bytes, "key_package_private_key")?;

    let welcome: WelcomeData = crate::protocol::deserialize_json(welcome_bytes, "welcome")?;
    if welcome.version != MLS_WELCOME_VERSION {
        return Err(MlsError::InvalidInput(format!(
            "unsupported welcome version {}",
            welcome.version
        )));
    }

    if welcome.group_id != group_id.trim() {
        return Err(MlsError::InvalidInput(format!(
            "welcome group mismatch: expected {}, got {}",
            group_id.trim(),
            welcome.group_id
        )));
    }

    if welcome.key_package_ref != key_package_ref.trim() {
        return Err(MlsError::InvalidInput(
            "welcome key package reference mismatch".to_owned(),
        ));
    }

    let welcome_metadata = WelcomeAeadMetadata {
        group_id: welcome.group_id.clone(),
        epoch: welcome.epoch,
        key_package_ref: welcome.key_package_ref.clone(),
        inviter_leaf_index: welcome.inviter_leaf_index,
        signer_leaf_index: welcome.signer_leaf_index,
        ephemeral_public_key: welcome.ephemeral_public_key.clone(),
    };
    let aad = welcome_metadata_bytes(&welcome_metadata)?;

    let shared_secret =
        x25519_shared_secret(key_package_private_key_bytes, &welcome.ephemeral_public_key)?;

    let welcome_key = derive_welcome_key(
        &shared_secret,
        &welcome.group_id,
        welcome.epoch,
        &welcome.key_package_ref,
    )?;

    let decrypted = decrypt_chacha20(&welcome_key, &welcome.nonce, &welcome.ciphertext, &aad)?;
    let welcome_payload: WelcomeEncryptedData =
        crate::protocol::deserialize_json(&decrypted, "welcome encrypted payload")?;

    if welcome_payload.group_id != welcome.group_id {
        return Err(MlsError::InvalidInput(
            "welcome encrypted payload group mismatch".to_owned(),
        ));
    }

    if welcome_payload.epoch != welcome.epoch {
        return Err(MlsError::InvalidInput(
            "welcome encrypted payload epoch mismatch".to_owned(),
        ));
    }

    if welcome_payload.ciphersuite != MLS_CIPHERSUITE_ID {
        return Err(MlsError::InvalidInput(format!(
            "unsupported ciphersuite {}",
            welcome_payload.ciphersuite
        )));
    }

    let signer = welcome_payload
        .members
        .iter()
        .find(|member| member.leaf_index == welcome.signer_leaf_index)
        .ok_or_else(|| MlsError::NotFound("welcome signer leaf index not found".to_owned()))?;

    let unsigned_welcome = UnsignedWelcomeData {
        version: welcome.version,
        group_id: welcome.group_id.clone(),
        epoch: welcome.epoch,
        key_package_ref: welcome.key_package_ref.clone(),
        inviter_leaf_index: welcome.inviter_leaf_index,
        signer_leaf_index: welcome.signer_leaf_index,
        ephemeral_public_key: welcome.ephemeral_public_key.clone(),
        nonce: welcome.nonce.clone(),
        ciphertext: welcome.ciphertext.clone(),
    };
    let unsigned_welcome_bytes = serialize_json(&unsigned_welcome)?;

    verify_signature(
        &signer.signing_public_key,
        &unsigned_welcome_bytes,
        &welcome.signature,
    )?;

    let self_member = welcome_payload
        .members
        .iter()
        .find(|member| member.user_id == credential.user_id)
        .ok_or_else(|| {
            MlsError::InvalidInput("credential user is not included in welcome members".to_owned())
        })?;

    if self_member.signing_public_key != credential.signing_public_key {
        return Err(MlsError::InvalidInput(
            "credential public key mismatch in welcome".to_owned(),
        ));
    }

    let state = crate::model::GroupStateData {
        version: crate::model::MLS_STATE_VERSION,
        group_id: welcome.group_id,
        epoch: welcome.epoch,
        ciphersuite: welcome_payload.ciphersuite,
        self_user_id: credential.user_id,
        self_signing_private_key: credential_private_key_bytes.to_vec(),
        self_signing_public_key: credential.signing_public_key,
        members: welcome_payload.members,
        epoch_secrets: vec![crate::model::EpochSecretData {
            epoch: welcome.epoch,
            secret: welcome_payload.epoch_secret,
        }],
    };

    encode_group_state(&state)
}

pub(crate) fn add_member(
    group_state_bytes: &[u8],
    member_key_package_bytes: &[u8],
) -> Result<AddMemberOutput, MlsError> {
    let mut state = decode_group_state(group_state_bytes)?;
    let member_key_package = decode_key_package(member_key_package_bytes)?;

    if state
        .members
        .iter()
        .any(|member| member.user_id == member_key_package.user_id)
    {
        return Err(MlsError::InvalidInput(format!(
            "member {} already exists in group",
            member_key_package.user_id
        )));
    }

    let next_leaf_index = state
        .members
        .iter()
        .map(|member| member.leaf_index)
        .max()
        .map(|leaf| leaf.saturating_add(1))
        .ok_or_else(|| MlsError::InvalidState("group has no members".to_owned()))?;

    let added_member = GroupMemberData {
        user_id: member_key_package.user_id,
        leaf_index: next_leaf_index,
        signing_public_key: member_key_package.signing_public_key,
        hpke_public_key: member_key_package.hpke_public_key,
    };

    let proposer_leaf_index = self_leaf_index(&state)?;
    let new_epoch = state.epoch.saturating_add(1);

    let unsigned_commit = UnsignedCommitData {
        version: MLS_COMMIT_VERSION,
        group_id: state.group_id.clone(),
        previous_epoch: state.epoch,
        new_epoch,
        proposer_leaf_index,
        operation: CommitOperationData::Add {
            member: added_member.clone(),
        },
    };
    let unsigned_commit_bytes = serialize_json(&unsigned_commit)?;
    let signature = sign_bytes(&state.self_signing_private_key, &unsigned_commit_bytes)?;

    let commit = CommitData {
        version: unsigned_commit.version,
        group_id: unsigned_commit.group_id.clone(),
        previous_epoch: unsigned_commit.previous_epoch,
        new_epoch: unsigned_commit.new_epoch,
        proposer_leaf_index: unsigned_commit.proposer_leaf_index,
        operation: unsigned_commit.operation,
        signature,
    };
    let commit_bytes = serialize_json(&commit)?;

    let current_secret = current_epoch_secret(&state)?;
    let next_epoch_secret = derive_epoch_secret(&current_secret, &unsigned_commit_bytes)?.to_vec();

    state.epoch = new_epoch;
    state.members.push(added_member.clone());
    add_epoch_secret(&mut state, new_epoch, next_epoch_secret.clone());

    let key_package_ref = hex::encode(sha256(member_key_package_bytes));

    let welcome_payload = WelcomeEncryptedData {
        group_id: state.group_id.clone(),
        epoch: state.epoch,
        epoch_secret: next_epoch_secret,
        members: state.members.clone(),
        ciphersuite: MLS_CIPHERSUITE_ID,
    };
    let welcome_payload_bytes = serialize_json(&welcome_payload)?;

    let (ephemeral_private_key, ephemeral_public_key) = generate_x25519_key_pair()?;
    let shared_secret =
        x25519_shared_secret(&ephemeral_private_key, &added_member.hpke_public_key)?;

    let welcome_metadata = WelcomeAeadMetadata {
        group_id: state.group_id.clone(),
        epoch: state.epoch,
        key_package_ref,
        inviter_leaf_index: proposer_leaf_index,
        signer_leaf_index: proposer_leaf_index,
        ephemeral_public_key: ephemeral_public_key.clone(),
    };
    let welcome_aad = welcome_metadata_bytes(&welcome_metadata)?;

    let welcome_key = derive_welcome_key(
        &shared_secret,
        &state.group_id,
        state.epoch,
        &welcome_metadata.key_package_ref,
    )?;

    let welcome_nonce = random_nonce()?.to_vec();
    let welcome_ciphertext = encrypt_chacha20(
        &welcome_key,
        &welcome_nonce,
        &welcome_payload_bytes,
        &welcome_aad,
    )?;

    let unsigned_welcome = UnsignedWelcomeData {
        version: MLS_WELCOME_VERSION,
        group_id: state.group_id.clone(),
        epoch: state.epoch,
        key_package_ref: welcome_metadata.key_package_ref,
        inviter_leaf_index: welcome_metadata.inviter_leaf_index,
        signer_leaf_index: welcome_metadata.signer_leaf_index,
        ephemeral_public_key,
        nonce: welcome_nonce,
        ciphertext: welcome_ciphertext,
    };
    let unsigned_welcome_bytes = serialize_json(&unsigned_welcome)?;

    let welcome_signature = sign_bytes(&state.self_signing_private_key, &unsigned_welcome_bytes)?;
    let welcome = WelcomeData {
        version: unsigned_welcome.version,
        group_id: unsigned_welcome.group_id,
        epoch: unsigned_welcome.epoch,
        key_package_ref: unsigned_welcome.key_package_ref,
        inviter_leaf_index: unsigned_welcome.inviter_leaf_index,
        signer_leaf_index: unsigned_welcome.signer_leaf_index,
        ephemeral_public_key: unsigned_welcome.ephemeral_public_key,
        nonce: unsigned_welcome.nonce,
        ciphertext: unsigned_welcome.ciphertext,
        signature: welcome_signature,
    };

    let state_bytes = encode_group_state(&state)?;
    let group_info = serialize_json(&crate::model::GroupStateMetadataOutput {
        group_id: state.group_id,
        epoch: state.epoch,
        self_user_id: state.self_user_id,
        members: state
            .members
            .iter()
            .map(|member| crate::model::GroupMemberMetadataOutput {
                user_id: member.user_id.clone(),
                leaf_index: member.leaf_index,
            })
            .collect(),
    })?;

    Ok(AddMemberOutput {
        state: state_bytes,
        commit: commit_bytes,
        welcome: serialize_json(&welcome)?,
        group_info,
        new_epoch,
    })
}

pub(crate) fn remove_member(
    group_state_bytes: &[u8],
    leaf_index: u32,
) -> Result<RemoveMemberOutput, MlsError> {
    let mut state = decode_group_state(group_state_bytes)?;

    let self_leaf = self_leaf_index(&state)?;
    if leaf_index == self_leaf {
        return Err(MlsError::InvalidInput(
            "cannot remove local member from local state".to_owned(),
        ));
    }

    if !state
        .members
        .iter()
        .any(|member| member.leaf_index == leaf_index)
    {
        return Err(MlsError::NotFound(format!(
            "leaf index {leaf_index} not found in group"
        )));
    }

    let proposer_leaf_index = self_leaf;
    let new_epoch = state.epoch.saturating_add(1);

    let unsigned_commit = UnsignedCommitData {
        version: MLS_COMMIT_VERSION,
        group_id: state.group_id.clone(),
        previous_epoch: state.epoch,
        new_epoch,
        proposer_leaf_index,
        operation: CommitOperationData::Remove { leaf_index },
    };
    let unsigned_commit_bytes = serialize_json(&unsigned_commit)?;
    let signature = sign_bytes(&state.self_signing_private_key, &unsigned_commit_bytes)?;

    let commit = CommitData {
        version: unsigned_commit.version,
        group_id: unsigned_commit.group_id.clone(),
        previous_epoch: unsigned_commit.previous_epoch,
        new_epoch: unsigned_commit.new_epoch,
        proposer_leaf_index,
        operation: unsigned_commit.operation,
        signature,
    };

    let current_secret = current_epoch_secret(&state)?;
    let next_epoch_secret = derive_epoch_secret(&current_secret, &unsigned_commit_bytes)?.to_vec();

    state
        .members
        .retain(|member| member.leaf_index != leaf_index);
    state.epoch = new_epoch;
    add_epoch_secret(&mut state, new_epoch, next_epoch_secret);

    Ok(RemoveMemberOutput {
        state: encode_group_state(&state)?,
        commit: serialize_json(&commit)?,
        new_epoch,
    })
}

pub(crate) fn process_commit(
    group_state_bytes: &[u8],
    commit_bytes: &[u8],
) -> Result<Vec<u8>, MlsError> {
    let mut state = decode_group_state(group_state_bytes)?;
    let commit: CommitData = crate::protocol::deserialize_json(commit_bytes, "commit")?;

    if commit.version != MLS_COMMIT_VERSION {
        return Err(MlsError::InvalidInput(format!(
            "unsupported commit version {}",
            commit.version
        )));
    }

    if commit.group_id != state.group_id {
        return Err(MlsError::InvalidInput(format!(
            "commit group mismatch: expected {}, got {}",
            state.group_id, commit.group_id
        )));
    }

    if commit.previous_epoch != state.epoch {
        return Err(MlsError::InvalidInput(format!(
            "commit previous_epoch mismatch: expected {}, got {}",
            state.epoch, commit.previous_epoch
        )));
    }

    if commit.new_epoch != state.epoch.saturating_add(1) {
        return Err(MlsError::InvalidInput(format!(
            "commit new_epoch mismatch: expected {}, got {}",
            state.epoch.saturating_add(1),
            commit.new_epoch
        )));
    }

    let proposer = state
        .members
        .iter()
        .find(|member| member.leaf_index == commit.proposer_leaf_index)
        .ok_or_else(|| {
            MlsError::NotFound(format!(
                "commit proposer leaf {} not found",
                commit.proposer_leaf_index
            ))
        })?;

    let unsigned_commit = UnsignedCommitData {
        version: commit.version,
        group_id: commit.group_id.clone(),
        previous_epoch: commit.previous_epoch,
        new_epoch: commit.new_epoch,
        proposer_leaf_index: commit.proposer_leaf_index,
        operation: commit.operation.clone(),
    };
    let unsigned_commit_bytes = serialize_json(&unsigned_commit)?;

    verify_signature(
        &proposer.signing_public_key,
        &unsigned_commit_bytes,
        &commit.signature,
    )?;

    let current_secret = current_epoch_secret(&state)?;
    let next_epoch_secret = derive_epoch_secret(&current_secret, &unsigned_commit_bytes)?.to_vec();

    match commit.operation {
        CommitOperationData::Add { member } => {
            if state
                .members
                .iter()
                .any(|existing| existing.leaf_index == member.leaf_index)
            {
                return Err(MlsError::InvalidInput(format!(
                    "cannot apply add commit with existing leaf index {}",
                    member.leaf_index
                )));
            }

            if state
                .members
                .iter()
                .any(|existing| existing.user_id == member.user_id)
            {
                return Err(MlsError::InvalidInput(format!(
                    "cannot apply add commit with existing user {}",
                    member.user_id
                )));
            }

            state.members.push(member);
        }
        CommitOperationData::Remove { leaf_index } => {
            let removed_member = state
                .members
                .iter()
                .find(|member| member.leaf_index == leaf_index)
                .ok_or_else(|| {
                    MlsError::NotFound(format!(
                        "cannot apply remove commit for unknown leaf index {leaf_index}"
                    ))
                })?;

            if removed_member.user_id == state.self_user_id {
                return Err(MlsError::InvalidState(
                    "local member has been removed from group".to_owned(),
                ));
            }

            state
                .members
                .retain(|member| member.leaf_index != leaf_index);
        }
    }

    state.epoch = commit.new_epoch;
    add_epoch_secret(&mut state, commit.new_epoch, next_epoch_secret);
    encode_group_state(&state)
}
