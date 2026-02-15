# End-to-End Encryption Policy (NIST SP 800-53)

<!-- COMPLIANCE_SENTINEL: TL-NE2E-001 | policy=compliance/NIST.SP.800-53/policies/05-end-to-end-encryption-policy.md | procedure=compliance/NIST.SP.800-53/procedures/05-end-to-end-encryption-procedure.md | control=mls-group-encryption -->
<!-- COMPLIANCE_SENTINEL: TL-NE2E-002 | policy=compliance/NIST.SP.800-53/policies/05-end-to-end-encryption-policy.md | procedure=compliance/NIST.SP.800-53/procedures/05-end-to-end-encryption-procedure.md | control=mls-key-management -->
<!-- COMPLIANCE_SENTINEL: TL-NE2E-003 | policy=compliance/NIST.SP.800-53/policies/05-end-to-end-encryption-policy.md | procedure=compliance/NIST.SP.800-53/procedures/05-end-to-end-encryption-procedure.md | control=mls-forward-secrecy -->
<!-- COMPLIANCE_SENTINEL: TL-NE2E-004 | policy=compliance/NIST.SP.800-53/policies/05-end-to-end-encryption-policy.md | procedure=compliance/NIST.SP.800-53/procedures/05-end-to-end-encryption-procedure.md | control=mls-local-storage -->

## Purpose

Define mandatory controls for end-to-end encryption (E2EE) of messaging communications aligned with NIST SP 800-53 Revision 5 requirements across System and Communications Protection (SC), Identification and Authentication (IA), and System and Information Integrity (SI) control families. This policy establishes requirements for implementing the Messaging Layer Security (MLS) protocol per [RFC 9420](https://datatracker.ietf.org/doc/rfc9420/) to ensure message confidentiality, integrity, and authentication.

## Scope

1. End-to-end encryption for group messaging (SC-8, SC-13).
2. Cryptographic key generation, distribution, and management (SC-12, IA-5).
3. Message integrity verification via authenticated encryption (SI-7, SC-8).
4. Client-side key storage and protection (SC-28, SC-12).
5. Forward secrecy and cryptographic module requirements (SC-8(1), SC-13).

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

1. `E2E-01` Transmission confidentiality via MLS encryption (SC-8, SC-13) (`TL-NE2E-001`).
2. `E2E-02` Cryptographic key establishment and management (SC-12, IA-5) (`TL-NE2E-002`).
3. `E2E-03` Forward secrecy via key derivation (SC-8(1)) (`TL-NE2E-003`).
4. `E2E-04` Protection of information at rest via IndexedDB (SC-28, SC-12) (`TL-NE2E-004`).

## Roles and Responsibilities

1. Security Owner maintains this policy, approves cryptographic implementations, and reviews control evidence.
2. Development leads implement and maintain MLS protocol in `@tearleads/mls-chat` package.
3. Security engineers audit cryptographic implementations and key management procedures.
4. Compliance owners retain evidence artifacts and conduct periodic security assessments.

## Policy Statements

### SC-8: Transmission Confidentiality and Integrity

- The system must protect the confidentiality and integrity of transmitted information (`E2E-01`, `TL-NE2E-001`).
- Messages must be encrypted using MLS group encryption with ChaCha20-Poly1305 (`E2E-01`).
- Message integrity must be verified via Poly1305 authentication tags (`E2E-01`).
- Group state changes must be authenticated via signed MLS commit messages (`E2E-01`).

### SC-8(1): Cryptographic Protection

- The system must implement cryptographic mechanisms to prevent unauthorized disclosure and modification (`E2E-03`, `TL-NE2E-003`).
- Forward secrecy must be maintained via epoch-based key evolution (`E2E-03`).
- Compromise of current keys must not expose past messages (`E2E-03`).
- Post-compromise security must limit exposure via key rotation on membership changes (`E2E-03`).

### SC-12: Cryptographic Key Establishment and Management

- The system must establish and manage cryptographic keys using NIST-approved algorithms (`E2E-02`, `TL-NE2E-002`).
- Key material must be generated using cryptographically secure random number generators (`E2E-02`).
- Key packages must be signed with Ed25519 to authenticate member identity (`E2E-02`).
- Key derivation must use the MLS key schedule as specified in RFC 9420 Section 8 (`E2E-02`).

### SC-13: Cryptographic Protection

- The system must implement NIST-approved or RFC-specified cryptographic algorithms (`E2E-01`, `TL-NE2E-001`).
- Encryption must use ChaCha20-Poly1305 AEAD per RFC 8439 (`E2E-01`).
- Hashing must use SHA-256 per FIPS 180-4 (`E2E-01`).
- Key exchange must use X25519 per RFC 7748 (`E2E-01`).
- Digital signatures must use Ed25519 per RFC 8032 (`E2E-02`).

### SC-28: Protection of Information at Rest

- The system must protect the confidentiality of cryptographic keys at rest (`E2E-04`, `TL-NE2E-004`).
- Private keys must be stored securely on client devices using IndexedDB (`E2E-04`).
- Private keys must never be transmitted to or stored on servers (`E2E-04`).
- Keys must be deleted when leaving groups or clearing data (`E2E-04`).

### IA-5: Authenticator Management

- The system must manage user authenticators (credentials, keys) securely (`E2E-02`, `TL-NE2E-002`).
- MLS credentials must contain user identity binding (`E2E-02`).
- Authenticator content must be protected via local-only storage (`E2E-04`).

### SI-7: Software, Firmware, and Information Integrity

- The system must detect unauthorized changes to information (`E2E-01`, `TL-NE2E-001`).
- All messages must be authenticated using Ed25519 digital signatures (`E2E-01`).
- AEAD authentication tags must be verified before accepting messages (`E2E-01`).

## Control Baselines

> **Implementation Note**: The `@tearleads/mls-chat` package currently provides a placeholder implementation with the MLS protocol interface. Full RFC 9420 compliance is planned via ts-mls library integration.

1. Planned baseline control: MLS group encryption via `@tearleads/mls-chat` package (`TL-NE2E-001`).
2. Planned baseline control: Ed25519 credential generation and key package signing (`TL-NE2E-002`).
3. Planned baseline control: Epoch-based key evolution for forward secrecy (`TL-NE2E-003`).
4. Implemented baseline control: IndexedDB storage for credentials and group states (`TL-NE2E-004`).
5. Program baseline expansion target: Post-quantum ciphersuite upgrade (X-Wing hybrid KEM).

## Implementation Reference

- **Package**: `@tearleads/mls-chat` (`packages/mls-chat/`)
- **MLS Client**: `packages/mls-chat/src/lib/mls.ts`
- **Key Storage**: `packages/mls-chat/src/lib/storage.ts` (IndexedDB)
- **React Integration**: `packages/mls-chat/src/context/MlsChatContext.tsx`

## Framework Mapping

| Sentinel | NIST SP 800-53 | HIPAA Security Rule | Control Outcome |
| --- | --- | --- | --- |
| `TL-NE2E-001` | SC-8, SC-13, SI-7 | 164.312(a)(2)(iv), 164.312(e)(2)(ii) | Messages are E2E encrypted with ChaCha20-Poly1305. |
| `TL-NE2E-002` | SC-12, IA-5 | 164.312(d), 164.312(c)(2) | Users authenticated via Ed25519 signed credentials. |
| `TL-NE2E-003` | SC-8(1) | 164.312(e)(1) | Forward secrecy via epoch-based key derivation. |
| `TL-NE2E-004` | SC-28, SC-12 | 164.312(a)(2)(iv) | Private keys stored locally, never transmitted. |
