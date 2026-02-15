# End-to-End Encryption Policy (HIPAA)

<!-- COMPLIANCE_SENTINEL: TL-HE2E-001 | policy=compliance/HIPAA/policies/05-end-to-end-encryption-policy.md | procedure=compliance/HIPAA/procedures/05-end-to-end-encryption-procedure.md | control=mls-group-encryption -->
<!-- COMPLIANCE_SENTINEL: TL-HE2E-002 | policy=compliance/HIPAA/policies/05-end-to-end-encryption-policy.md | procedure=compliance/HIPAA/procedures/05-end-to-end-encryption-procedure.md | control=mls-key-management -->
<!-- COMPLIANCE_SENTINEL: TL-HE2E-003 | policy=compliance/HIPAA/policies/05-end-to-end-encryption-policy.md | procedure=compliance/HIPAA/procedures/05-end-to-end-encryption-procedure.md | control=mls-forward-secrecy -->
<!-- COMPLIANCE_SENTINEL: TL-HE2E-004 | policy=compliance/HIPAA/policies/05-end-to-end-encryption-policy.md | procedure=compliance/HIPAA/procedures/05-end-to-end-encryption-procedure.md | control=mls-local-storage -->

## Purpose

Define mandatory controls for end-to-end encryption (E2EE) of messaging communications aligned with HIPAA Security Rule requirements for protecting electronic protected health information (ePHI). This policy establishes requirements for implementing the Messaging Layer Security (MLS) protocol per [RFC 9420](https://datatracker.ietf.org/doc/rfc9420/) to ensure message confidentiality, integrity, and authentication.

## Regulatory Authority

- **45 CFR 164.312(a)(2)(iv)** - Encryption and Decryption (Technical Safeguard - Addressable)
- **45 CFR 164.312(c)(1)** - Integrity (Technical Safeguard - Required)
- **45 CFR 164.312(c)(2)** - Mechanism to Authenticate ePHI (Technical Safeguard - Addressable)
- **45 CFR 164.312(d)** - Person or Entity Authentication (Technical Safeguard - Required)
- **45 CFR 164.312(e)(1)** - Transmission Security (Technical Safeguard - Required)
- **45 CFR 164.312(e)(2)(i)** - Integrity Controls (Technical Safeguard - Addressable)
- **45 CFR 164.312(e)(2)(ii)** - Encryption (Technical Safeguard - Addressable)

## Scope

1. End-to-end encryption for group messaging containing ePHI (164.312(a)(2)(iv), 164.312(e)(2)(ii)).
2. Cryptographic key generation, distribution, and rotation (164.312(d)).
3. Message integrity verification via authenticated encryption (164.312(c)(1), 164.312(e)(2)(i)).
4. Client-side key storage and protection (164.312(a)(2)(iv)).
5. Forward secrecy and post-compromise security properties.

## Standards Reference

This policy implements the Messaging Layer Security (MLS) protocol as defined in:

- **[RFC 9420](https://datatracker.ietf.org/doc/rfc9420/)** - The Messaging Layer Security (MLS) Protocol (July 2023)
- **[RFC 9180](https://datatracker.ietf.org/doc/rfc9180/)** - Hybrid Public Key Encryption (HPKE)

### Required Ciphersuite

All MLS implementations must use ciphersuite `MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519` (0x0003):

| Component | Algorithm | Reference |
| --- | --- | --- |
| Key Exchange (KEM) | X25519 (Curve25519 ECDH) | [RFC 7748](https://datatracker.ietf.org/doc/rfc7748/) |
| Symmetric Encryption (AEAD) | ChaCha20-Poly1305 | [RFC 8439](https://datatracker.ietf.org/doc/rfc8439/) |
| Hash Function | SHA-256 | [FIPS 180-4](https://csrc.nist.gov/publications/detail/fips/180/4/final) |
| Digital Signature | Ed25519 | [RFC 8032](https://datatracker.ietf.org/doc/rfc8032/) |

## Policy Control Index

1. `E2E-01` Message encryption via MLS group protocol (164.312(a)(2)(iv), 164.312(e)(2)(ii)) (`TL-HE2E-001`).
2. `E2E-02` Cryptographic key management with epoch-based rotation (164.312(d)) (`TL-HE2E-002`).
3. `E2E-03` Forward secrecy via key derivation and ratcheting (164.312(e)(1)) (`TL-HE2E-003`).
4. `E2E-04` Client-side private key storage in IndexedDB (164.312(a)(2)(iv)) (`TL-HE2E-004`).

## Roles and Responsibilities

1. Security Officer maintains this policy, approves cryptographic implementations, and reviews control evidence.
2. Development leads implement and maintain MLS protocol in `@tearleads/mls-chat` package.
3. Security engineers audit cryptographic implementations and key management procedures.
4. Compliance owners retain evidence artifacts and conduct periodic security evaluations.

## Policy Statements

### 164.312(a)(2)(iv) Encryption and Decryption

- Messages containing ePHI must be encrypted using MLS group encryption (`E2E-01`, `TL-HE2E-001`).
- Encryption must use ChaCha20-Poly1305 AEAD with 256-bit keys (`E2E-01`).
- Private keys must be stored securely on client devices using IndexedDB (`E2E-04`, `TL-HE2E-004`).
- Private keys must never be transmitted to or stored on servers (`E2E-04`).
- Key material must be generated using cryptographically secure random number generators (`E2E-02`).

### 164.312(c)(1) Integrity

- All messages must be authenticated using Ed25519 digital signatures (`E2E-01`, `TL-HE2E-001`).
- Message integrity must be verified via Poly1305 authentication tags (`E2E-01`).
- Group state changes must be authenticated via MLS commit messages (`E2E-02`).

### 164.312(d) Person or Entity Authentication

- Users must be uniquely identified via MLS credentials containing user identity (`E2E-02`, `TL-HE2E-002`).
- Key packages must be signed with Ed25519 to authenticate member identity (`E2E-02`).
- Group membership changes must be authenticated via signed commit messages (`E2E-02`).

### 164.312(e)(1) Transmission Security

- Messages must be encrypted end-to-end before transmission (`E2E-01`, `TL-HE2E-001`).
- Forward secrecy must be maintained via epoch-based key evolution (`E2E-03`, `TL-HE2E-003`).
- Compromise of current keys must not expose past messages (forward secrecy) (`E2E-03`).
- Post-compromise security must limit exposure from key compromise via key rotation (`E2E-03`).

### 164.312(e)(2)(ii) Encryption

- All message content must be encrypted using MLS application messages (`E2E-01`).
- Encryption keys must be derived per-epoch using HKDF-SHA256 (`E2E-02`).
- Key derivation must use the MLS key schedule as specified in RFC 9420 Section 8 (`E2E-02`).

## Control Baselines

> **Implementation Note**: The `@tearleads/mls-chat` package currently provides a placeholder implementation with the MLS protocol interface. Full RFC 9420 compliance is planned via ts-mls library integration.

1. Planned baseline control: MLS group encryption via `@tearleads/mls-chat` package (`TL-HE2E-001`).
2. Planned baseline control: Ed25519 credential generation and key package signing (`TL-HE2E-002`).
3. Planned baseline control: Epoch-based key evolution for forward secrecy (`TL-HE2E-003`).
4. Implemented baseline control: IndexedDB storage for credentials and group states (`TL-HE2E-004`).
5. Program baseline expansion target: Post-quantum ciphersuite upgrade (X-Wing hybrid KEM).

## Security Properties

### Forward Secrecy

- Compromise of current epoch keys does not expose messages from previous epochs.
- Each epoch derives new encryption keys via the MLS key schedule.
- Key material is deleted after epoch transitions.

### Post-Compromise Security

- Key rotation on member add/remove limits exposure window.
- Commit messages trigger epoch advancement and key regeneration.
- Compromised members can be removed to restore security.

### Authentication

- All group members are authenticated via signed key packages.
- Message senders are authenticated via AEAD additional data.
- Group state changes require valid signatures from authorized members.

## Implementation Reference

- **Package**: `@tearleads/mls-chat` (`packages/mls-chat/`)
- **MLS Client**: `packages/mls-chat/src/lib/mls.ts`
- **Key Storage**: `packages/mls-chat/src/lib/storage.ts` (IndexedDB)
- **React Integration**: `packages/mls-chat/src/context/MlsChatContext.tsx`

## Framework Mapping

| Sentinel | HIPAA Security Rule | NIST SP 800-53 | Control Outcome |
| --- | --- | --- | --- |
| `TL-HE2E-001` | 164.312(a)(2)(iv), 164.312(e)(2)(ii) | SC-8, SC-13 | Messages are E2E encrypted with ChaCha20-Poly1305. |
| `TL-HE2E-002` | 164.312(d), 164.312(c)(2) | IA-5, SC-12 | Users authenticated via Ed25519 signed credentials. |
| `TL-HE2E-003` | 164.312(e)(1) | SC-8(1) | Forward secrecy via epoch-based key derivation. |
| `TL-HE2E-004` | 164.312(a)(2)(iv) | SC-12, SC-28 | Private keys stored locally, never transmitted. |
