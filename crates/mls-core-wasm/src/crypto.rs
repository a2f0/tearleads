use chacha20poly1305::{
    ChaCha20Poly1305,
    aead::{Aead, KeyInit, Payload},
};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret as X25519Secret};

use crate::error::MlsError;

const SIGNING_KEY_LEN: usize = 32;
const SIGNATURE_LEN: usize = 64;
const X25519_KEY_LEN: usize = 32;
const CHACHA20_KEY_LEN: usize = 32;
const CHACHA20_NONCE_LEN: usize = 12;

/// Validates and clones a fixed-size key byte slice.
pub fn require_key_bytes<const LEN: usize>(
    key_bytes: &[u8],
    name: &str,
) -> Result<[u8; LEN], MlsError> {
    if key_bytes.len() != LEN {
        return Err(MlsError::InvalidInput(format!(
            "{name} must be {LEN} bytes"
        )));
    }

    let mut output = [0_u8; LEN];
    output.copy_from_slice(key_bytes);
    Ok(output)
}

/// Returns SHA-256 digest bytes.
pub fn sha256(input: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(input);
    let digest = hasher.finalize();
    let mut bytes = [0_u8; 32];
    bytes.copy_from_slice(&digest);
    bytes
}

/// Fills bytes with system randomness.
pub fn random_bytes<const LEN: usize>() -> Result<[u8; LEN], MlsError> {
    let mut bytes = [0_u8; LEN];
    getrandom::getrandom(&mut bytes)
        .map_err(|error| MlsError::Crypto(format!("randomness failure: {error}")))?;
    Ok(bytes)
}

/// Constructs an Ed25519 signing key from private key bytes.
pub fn signing_key_from_private(private_key_bytes: &[u8]) -> Result<SigningKey, MlsError> {
    let key_bytes = require_key_bytes::<SIGNING_KEY_LEN>(private_key_bytes, "signing private key")?;
    Ok(SigningKey::from_bytes(&key_bytes))
}

/// Constructs an Ed25519 verifying key from public key bytes.
pub fn verifying_key_from_public(public_key_bytes: &[u8]) -> Result<VerifyingKey, MlsError> {
    let key_bytes = require_key_bytes::<SIGNING_KEY_LEN>(public_key_bytes, "signing public key")?;
    VerifyingKey::from_bytes(&key_bytes)
        .map_err(|error| MlsError::Crypto(format!("invalid signing public key: {error}")))
}

/// Signs message bytes with an Ed25519 private key.
pub fn sign_bytes(private_key_bytes: &[u8], message: &[u8]) -> Result<Vec<u8>, MlsError> {
    let signing_key = signing_key_from_private(private_key_bytes)?;
    Ok(signing_key.sign(message).to_bytes().to_vec())
}

/// Verifies Ed25519 signature bytes.
pub fn verify_signature(
    public_key_bytes: &[u8],
    message: &[u8],
    signature_bytes: &[u8],
) -> Result<(), MlsError> {
    if signature_bytes.len() != SIGNATURE_LEN {
        return Err(MlsError::Crypto("signature must be 64 bytes".to_owned()));
    }

    let verifying_key = verifying_key_from_public(public_key_bytes)?;
    let signature = Signature::from_slice(signature_bytes)
        .map_err(|error| MlsError::Crypto(format!("invalid signature bytes: {error}")))?;

    verifying_key
        .verify(message, &signature)
        .map_err(|error| MlsError::Crypto(format!("signature verification failed: {error}")))
}

/// Generates an X25519 key pair.
pub fn generate_x25519_key_pair() -> Result<(Vec<u8>, Vec<u8>), MlsError> {
    let private = random_bytes::<X25519_KEY_LEN>()?;
    let private_secret = X25519Secret::from(private);
    let public = X25519PublicKey::from(&private_secret);
    Ok((
        private_secret.to_bytes().to_vec(),
        public.as_bytes().to_vec(),
    ))
}

/// Computes an X25519 shared secret.
pub fn x25519_shared_secret(
    private_key_bytes: &[u8],
    peer_public_key_bytes: &[u8],
) -> Result<[u8; X25519_KEY_LEN], MlsError> {
    let private = require_key_bytes::<X25519_KEY_LEN>(private_key_bytes, "X25519 private key")?;
    let peer_public =
        require_key_bytes::<X25519_KEY_LEN>(peer_public_key_bytes, "X25519 public key")?;

    let private_secret = X25519Secret::from(private);
    let peer = X25519PublicKey::from(peer_public);
    Ok(*private_secret.diffie_hellman(&peer).as_bytes())
}

/// Derives a fixed-size key with HKDF-SHA256.
pub fn hkdf_derive<const LEN: usize>(
    salt: Option<&[u8]>,
    input_key_material: &[u8],
    info: &[u8],
) -> Result<[u8; LEN], MlsError> {
    let hkdf = Hkdf::<Sha256>::new(salt, input_key_material);
    let mut output = [0_u8; LEN];

    hkdf.expand(info, &mut output)
        .map_err(|_| MlsError::Crypto("HKDF expansion failed".to_owned()))?;

    Ok(output)
}

/// Derives a next-epoch secret from current secret and commit payload.
pub fn derive_epoch_secret(
    current_epoch_secret: &[u8],
    commit_payload_bytes: &[u8],
) -> Result<[u8; CHACHA20_KEY_LEN], MlsError> {
    let current =
        require_key_bytes::<CHACHA20_KEY_LEN>(current_epoch_secret, "current epoch secret")?;
    hkdf_derive::<CHACHA20_KEY_LEN>(
        Some(&current),
        commit_payload_bytes,
        b"tearleads-mls/epoch-secret/v1",
    )
}

/// Derives an application message key for a specific epoch.
pub fn derive_app_message_key(
    epoch_secret: &[u8],
    group_id: &str,
    epoch: u64,
) -> Result<[u8; CHACHA20_KEY_LEN], MlsError> {
    let secret = require_key_bytes::<CHACHA20_KEY_LEN>(epoch_secret, "epoch secret")?;
    let mut info = Vec::with_capacity(64);
    info.extend_from_slice(b"tearleads-mls/app-key/v1:");
    info.extend_from_slice(group_id.as_bytes());
    info.extend_from_slice(&epoch.to_be_bytes());

    hkdf_derive::<CHACHA20_KEY_LEN>(None, &secret, &info)
}

/// Derives a welcome message key from shared secret and metadata.
pub fn derive_welcome_key(
    shared_secret: &[u8],
    group_id: &str,
    epoch: u64,
    key_package_ref: &str,
) -> Result<[u8; CHACHA20_KEY_LEN], MlsError> {
    let mut salt_data = Vec::with_capacity(group_id.len() + key_package_ref.len() + 8 + 2);
    salt_data.extend_from_slice(group_id.as_bytes());
    salt_data.extend_from_slice(b":");
    salt_data.extend_from_slice(key_package_ref.as_bytes());
    salt_data.extend_from_slice(b":");
    salt_data.extend_from_slice(&epoch.to_be_bytes());

    let salt = sha256(&salt_data);
    hkdf_derive::<CHACHA20_KEY_LEN>(Some(&salt), shared_secret, b"tearleads-mls/welcome-key/v1")
}

/// Encrypts payload with ChaCha20-Poly1305.
pub fn encrypt_chacha20(
    key_bytes: &[u8],
    nonce_bytes: &[u8],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, MlsError> {
    let key = require_key_bytes::<CHACHA20_KEY_LEN>(key_bytes, "ChaCha20 key")?;
    let nonce = require_key_bytes::<CHACHA20_NONCE_LEN>(nonce_bytes, "ChaCha20 nonce")?;

    let cipher = ChaCha20Poly1305::new((&key).into());
    cipher
        .encrypt(
            (&nonce).into(),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|error| MlsError::Crypto(format!("message encryption failed: {error}")))
}

/// Decrypts payload with ChaCha20-Poly1305.
pub fn decrypt_chacha20(
    key_bytes: &[u8],
    nonce_bytes: &[u8],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, MlsError> {
    let key = require_key_bytes::<CHACHA20_KEY_LEN>(key_bytes, "ChaCha20 key")?;
    let nonce = require_key_bytes::<CHACHA20_NONCE_LEN>(nonce_bytes, "ChaCha20 nonce")?;

    let cipher = ChaCha20Poly1305::new((&key).into());
    cipher
        .decrypt(
            (&nonce).into(),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|error| MlsError::Crypto(format!("message decryption failed: {error}")))
}

/// Returns a random ChaCha20 nonce.
pub fn random_nonce() -> Result<[u8; CHACHA20_NONCE_LEN], MlsError> {
    random_bytes::<CHACHA20_NONCE_LEN>()
}
