use crate::{
    crypto::{
        decrypt_chacha20, derive_app_message_key, encrypt_chacha20, random_nonce, sign_bytes,
        verify_signature,
    },
    error::MlsError,
    model::{AppMessageData, DecryptOutput, MLS_APP_MESSAGE_VERSION, UnsignedAppMessageData},
    protocol::{
        current_epoch_secret, decode_group_state, epoch_secret_for, metadata_bytes,
        self_leaf_index, serialize_json,
    },
};

pub(crate) fn encrypt_message(
    group_state_bytes: &[u8],
    plaintext: &[u8],
) -> Result<Vec<u8>, MlsError> {
    let state = decode_group_state(group_state_bytes)?;
    let sender_leaf_index = self_leaf_index(&state)?;

    let epoch_secret = current_epoch_secret(&state)?;
    let message_key = derive_app_message_key(&epoch_secret, &state.group_id, state.epoch)?;

    let nonce = random_nonce()?.to_vec();
    let authenticated_data = metadata_bytes(&state.group_id, state.epoch, sender_leaf_index)?;
    let ciphertext = encrypt_chacha20(&message_key, &nonce, plaintext, &authenticated_data)?;

    let unsigned_message = UnsignedAppMessageData {
        version: MLS_APP_MESSAGE_VERSION,
        group_id: state.group_id,
        epoch: state.epoch,
        sender_leaf_index,
        nonce,
        ciphertext,
    };

    let unsigned_message_bytes = serialize_json(&unsigned_message)?;
    let signature = sign_bytes(&state.self_signing_private_key, &unsigned_message_bytes)?;

    let message = AppMessageData {
        version: unsigned_message.version,
        group_id: unsigned_message.group_id,
        epoch: unsigned_message.epoch,
        sender_leaf_index: unsigned_message.sender_leaf_index,
        nonce: unsigned_message.nonce,
        ciphertext: unsigned_message.ciphertext,
        signature,
    };

    serialize_json(&message)
}

pub(crate) fn decrypt_message(
    group_state_bytes: &[u8],
    ciphertext: &[u8],
) -> Result<DecryptOutput, MlsError> {
    let state = decode_group_state(group_state_bytes)?;
    let message: AppMessageData =
        crate::protocol::deserialize_json(ciphertext, "application message")?;

    if message.version != MLS_APP_MESSAGE_VERSION {
        return Err(MlsError::InvalidInput(format!(
            "unsupported application message version {}",
            message.version
        )));
    }

    if message.group_id != state.group_id {
        return Err(MlsError::InvalidInput(format!(
            "application message group mismatch: expected {}, got {}",
            state.group_id, message.group_id
        )));
    }

    let sender = state
        .members
        .iter()
        .find(|member| member.leaf_index == message.sender_leaf_index)
        .ok_or_else(|| {
            MlsError::NotFound(format!(
                "application message sender leaf {} not found",
                message.sender_leaf_index
            ))
        })?;

    let unsigned_message = UnsignedAppMessageData {
        version: message.version,
        group_id: message.group_id.clone(),
        epoch: message.epoch,
        sender_leaf_index: message.sender_leaf_index,
        nonce: message.nonce.clone(),
        ciphertext: message.ciphertext.clone(),
    };
    let unsigned_message_bytes = serialize_json(&unsigned_message)?;

    verify_signature(
        &sender.signing_public_key,
        &unsigned_message_bytes,
        &message.signature,
    )?;

    let epoch_secret = epoch_secret_for(&state.epoch_secrets, message.epoch)?;
    let message_key = derive_app_message_key(&epoch_secret, &message.group_id, message.epoch)?;
    let authenticated_data =
        metadata_bytes(&message.group_id, message.epoch, message.sender_leaf_index)?;
    let plaintext = decrypt_chacha20(
        &message_key,
        &message.nonce,
        &message.ciphertext,
        &authenticated_data,
    )?;

    Ok(DecryptOutput {
        sender_id: sender.user_id.clone(),
        plaintext,
        authenticated_data,
    })
}
