# End-to-End Encryption Policy (SOC2)

<!-- COMPLIANCE_SENTINEL: TL-E2E-001 | policy=compliance/SOC2/policies/05-end-to-end-encryption-policy.md | procedure=compliance/SOC2/procedures/05-end-to-end-encryption-procedure.md | control=mls-group-encryption -->
<!-- COMPLIANCE_SENTINEL: TL-E2E-002 | policy=compliance/SOC2/policies/05-end-to-end-encryption-policy.md | procedure=compliance/SOC2/procedures/05-end-to-end-encryption-procedure.md | control=mls-key-management -->
<!-- COMPLIANCE_SENTINEL: TL-E2E-003 | policy=compliance/SOC2/policies/05-end-to-end-encryption-policy.md | procedure=compliance/SOC2/procedures/05-end-to-end-encryption-procedure.md | control=mls-forward-secrecy -->
<!-- COMPLIANCE_SENTINEL: TL-E2E-004 | policy=compliance/SOC2/policies/05-end-to-end-encryption-policy.md | procedure=compliance/SOC2/procedures/05-end-to-end-encryption-procedure.md | control=mls-local-storage -->

## Purpose

Define mandatory controls for end-to-end encryption (E2EE) of messaging communications to protect confidentiality and integrity of customer data in transit and at rest. This policy establishes requirements for implementing the Messaging Layer Security (MLS) protocol per [RFC 9420](https://datatracker.ietf.org/doc/rfc9420/) aligned with SOC2 Trust Services Criteria for Security, Confidentiality, and Processing Integrity.

## Scope

1. End-to-end encryption for group messaging (CC6.1, CC6.7).
2. Cryptographic key generation, distribution, and management (CC6.1).
3. Message integrity verification via authenticated encryption (PI1.1).
4. Client-side key storage and protection (CC6.1, C1.1).
5. Forward secrecy and cryptographic protection during transmission (CC6.7).

## Trust Services Criteria Mapping

| Criteria | Description | Controls |
| --- | --- | --- |
| CC6.1 | Logical and Physical Access Controls | `TL-E2E-001`, `TL-E2E-002`, `TL-E2E-004` |
| CC6.7 | Transmission Protections | `TL-E2E-001`, `TL-E2E-003` |
| C1.1 | Confidentiality of Information | `TL-E2E-001`, `TL-E2E-004` |
| PI1.1 | Processing Integrity | `TL-E2E-001` |

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

1. `E2E-01` Message encryption via MLS group protocol (CC6.1, CC6.7, C1.1) (`TL-E2E-001`).
2. `E2E-02` Cryptographic key management with Ed25519 authentication (CC6.1) (`TL-E2E-002`).
3. `E2E-03` Forward secrecy via epoch-based key evolution (CC6.7) (`TL-E2E-003`).
4. `E2E-04` Client-side private key storage in IndexedDB (CC6.1, C1.1) (`TL-E2E-004`).

## Roles and Responsibilities

1. Security Owner maintains this policy, approves cryptographic implementations, and reviews control evidence.
2. Development leads implement and maintain MLS protocol in `@tearleads/mls-chat` package.
3. Security engineers audit cryptographic implementations and key management procedures.
4. Compliance owners retain evidence artifacts and conduct periodic security reviews.

## Policy Statements

### CC6.1: Logical and Physical Access Controls

- Access to decrypted message content must require valid group membership credentials (`E2E-01`, `TL-E2E-001`).
- Cryptographic keys must be generated using secure random sources (`E2E-02`, `TL-E2E-002`).
- Private keys must be stored only on client devices and never transmitted to servers (`E2E-04`, `TL-E2E-004`).
- Users must be authenticated via Ed25519 signed credentials before joining groups (`E2E-02`).

### CC6.7: Transmission Protections

- Messages must be encrypted end-to-end using MLS group encryption before transmission (`E2E-01`, `TL-E2E-001`).
- Encryption must use ChaCha20-Poly1305 AEAD with 256-bit keys (`E2E-01`).
- Forward secrecy must be maintained via epoch-based key evolution (`E2E-03`, `TL-E2E-003`).
- Compromise of current keys must not expose previously transmitted messages (`E2E-03`).

### C1.1: Confidentiality of Information

- Customer message content must be encrypted such that only intended recipients can decrypt (`E2E-01`, `TL-E2E-001`).
- Service operators must not have access to decryption keys (`E2E-04`, `TL-E2E-004`).
- Key material must be protected at rest using IndexedDB isolation (`E2E-04`).

### PI1.1: Processing Integrity

- Message integrity must be verified via Poly1305 authentication tags (`E2E-01`, `TL-E2E-001`).
- Group state changes must be authenticated via Ed25519 signed commit messages (`E2E-02`).
- Authentication failures must result in message rejection (`E2E-01`).

## Control Baselines

1. Implemented baseline control: MLS group encryption via `@tearleads/mls-chat` package (`TL-E2E-001`).
2. Implemented baseline control: Ed25519 credential generation and key package signing (`TL-E2E-002`).
3. Implemented baseline control: Epoch-based key evolution for forward secrecy (`TL-E2E-003`).
4. Implemented baseline control: IndexedDB storage for credentials and group states (`TL-E2E-004`).
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

### Zero-Knowledge Service

- Service operators cannot decrypt message content.
- Private keys exist only on client devices.
- Server stores only encrypted ciphertext and public metadata.

## Implementation Reference

- **Package**: `@tearleads/mls-chat` (`packages/mls-chat/`)
- **MLS Client**: `packages/mls-chat/src/lib/mls.ts`
- **Key Storage**: `packages/mls-chat/src/lib/storage.ts` (IndexedDB)
- **React Integration**: `packages/mls-chat/src/context/MlsChatContext.tsx`

## Framework Mapping

| Sentinel | SOC2 TSC | NIST SP 800-53 | HIPAA | Control Outcome |
| --- | --- | --- | --- | --- |
| `TL-E2E-001` | CC6.1, CC6.7, C1.1, PI1.1 | SC-8, SC-13 | 164.312(a)(2)(iv) | Messages are E2E encrypted with ChaCha20-Poly1305. |
| `TL-E2E-002` | CC6.1 | SC-12, IA-5 | 164.312(d) | Users authenticated via Ed25519 signed credentials. |
| `TL-E2E-003` | CC6.7 | SC-8(1) | 164.312(e)(1) | Forward secrecy via epoch-based key derivation. |
| `TL-E2E-004` | CC6.1, C1.1 | SC-28, SC-12 | 164.312(a)(2)(iv) | Private keys stored locally, never transmitted. |
