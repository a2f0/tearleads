# End-to-End Encryption Technical Control Map (SOC2)

This map ties end-to-end encryption policy controls to concrete implementation and test evidence, aligned with SOC2 Trust Services Criteria.

> **Implementation Status**: The `@tearleads/mls-chat` package currently provides a placeholder implementation with the MLS protocol interface. Full RFC 9420 compliance with production-grade cryptography is planned via ts-mls library integration. Controls marked "Planned" are not yet cryptographically compliant.

## Sentinel Controls

| Sentinel | SOC2 TSC | Status | Description | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- | --- | --- |
| `TL-E2E-001` | CC6.1, CC6.7, C1.1, PI1.1 | Planned | MLS group encryption with ChaCha20-Poly1305 | [`packages/mls-core/src/mls.ts`](../../../packages/mls-core/src/mls.ts) | `pnpm --filter @tearleads/mls-chat test -- --grep "encrypt"` |
| `TL-E2E-002` | CC6.1 | Planned | Ed25519 credential and key package management | [`packages/mls-core/src/mls.ts`](../../../packages/mls-core/src/mls.ts) (generateCredential, generateKeyPackage) | `pnpm --filter @tearleads/mls-chat test -- --grep "credential"` |
| `TL-E2E-003` | CC6.7 | Planned | Epoch-based key evolution for forward secrecy | [`packages/mls-core/src/mls.ts`](../../../packages/mls-core/src/mls.ts) (processCommit, epoch tracking) | `pnpm --filter @tearleads/mls-chat test -- --grep "epoch"` |
| `TL-E2E-004` | CC6.1, C1.1 | Implemented | IndexedDB local storage for private keys | [`packages/mls-core/src/storage.ts`](../../../packages/mls-core/src/storage.ts) | `pnpm --filter @tearleads/mls-chat test -- --grep "storage"` |

## SOC2 Trust Services Criteria Mapping

### Common Criteria (CC)

| Criteria | Description | Implementation | Sentinel |
| --- | --- | --- | --- |
| CC6.1 | Logical and Physical Access Controls | MLS credentials authenticate group membership; private keys stored locally | `TL-E2E-001`, `TL-E2E-002`, `TL-E2E-004` |
| CC6.7 | Transmission Protections | E2E encryption with ChaCha20-Poly1305; forward secrecy via epochs | `TL-E2E-001`, `TL-E2E-003` |

### Confidentiality (C)

| Criteria | Description | Implementation | Sentinel |
| --- | --- | --- | --- |
| C1.1 | Confidentiality of Information | Messages encrypted client-side; operators cannot decrypt | `TL-E2E-001`, `TL-E2E-004` |

### Processing Integrity (PI)

| Criteria | Description | Implementation | Sentinel |
| --- | --- | --- | --- |
| PI1.1 | Processing Integrity | AEAD authentication tags; Ed25519 signed commits | `TL-E2E-001` |

## Control Details

### TL-E2E-001: Message Encryption (CC6.1, CC6.7, C1.1, PI1.1)

**SOC2 Requirements Addressed:**

- CC6.1: Logical access controls restrict information access to authorized users
- CC6.7: Information transmitted is protected during transmission
- C1.1: Confidential information is protected from unauthorized access
- PI1.1: Processing is complete, valid, accurate, and authorized

**Implementation:**

- `packages/mls-core/src/mls.ts` - MLS client with encryption/decryption
- `packages/mls-chat/src/hooks/useGroupMessages.ts` - React integration

**Cryptographic Configuration (RFC 9420):**

- **Ciphersuite**: `MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519` (0x0003)
- **Key Exchange**: X25519 (Curve25519 ECDH) per [RFC 7748](https://datatracker.ietf.org/doc/rfc7748/)
- **AEAD**: ChaCha20-Poly1305 per [RFC 8439](https://datatracker.ietf.org/doc/rfc8439/)
- **Hash**: SHA-256 per [FIPS 180-4](https://csrc.nist.gov/publications/detail/fips/180/4/final)
- **Signature**: Ed25519 per [RFC 8032](https://datatracker.ietf.org/doc/rfc8032/)

**Key Operations:**

- `encryptMessage(groupId, plaintext)` - Encrypt with group's current epoch key
- `decryptMessage(groupId, ciphertext)` - Decrypt and verify authentication tag

### TL-E2E-002: Key Management (CC6.1)

**SOC2 Requirements Addressed:**

- CC6.1: Logical access controls for authentication and authorization

**Implementation:**

- `packages/mls-core/src/mls.ts` - Credential and key package generation

**Key Operations:**

- `generateCredential()` - Create Ed25519 identity credential with user binding
- `generateKeyPackage()` - Create signed key package for group invitations
- Key packages signed with Ed25519 private key (RFC 8032)
- User identity bound to credential for authentication

**Key Material:**

- Private keys: 32 bytes (256-bit), generated via `crypto.getRandomValues()`
- Credential bundle: User identity + public key
- Key package: Public key + lifetime + extensions, signed

### TL-E2E-003: Forward Secrecy (CC6.7)

**SOC2 Requirements Addressed:**

- CC6.7: Protections during transmission include protecting against unauthorized access

**Implementation:**

- `packages/mls-core/src/mls.ts` - Epoch management and key evolution

**Security Properties:**

- **Forward Secrecy**: Compromise of epoch N keys does not expose epochs 0..N-1
- **Post-Compromise Security**: Key rotation after member change limits exposure
- **Epoch Advancement**: Each commit increments epoch and derives new keys

**Key Operations:**

- `processCommit()` - Advance epoch and derive new encryption keys
- `addMember()` / `removeMember()` - Trigger epoch advancement
- Epoch counter tracked in `GroupState.epoch`

### TL-E2E-004: Local Key Storage (CC6.1, C1.1)

**SOC2 Requirements Addressed:**

- CC6.1: Logical access controls for key protection
- C1.1: Confidential information is protected

**Implementation:**

- `packages/mls-core/src/storage.ts` - IndexedDB storage layer

**Storage Schema (IndexedDB `tearleads-mls`):**

| Store | Key | Contents | Purpose |
| --- | --- | --- | --- |
| `credentials` | userId | `MlsCredential` (credentialBundle, privateKey) | User's MLS identity |
| `keyPackages` | ref | `LocalKeyPackage` (keyPackage, privateKey) | Unused invitation packages |
| `groupStates` | groupId | `LocalMlsState` (serializedState, epoch) | Group decryption capability |

**Security Controls:**

- Private keys stored only on client device
- Private keys never transmitted to server (zero-knowledge service)
- IndexedDB isolated per origin (same-origin policy)
- Keys deleted on `leaveGroup()` or `clearAll()`

## RFC 9420 Protocol Compliance

| MLS Operation | Implementation | RFC Section |
| --- | --- | --- |
| Group Creation | `createGroup(groupId)` | RFC 9420 §11.1 |
| Welcome Processing | `joinGroup(groupId, welcome, keyPackageRef)` | RFC 9420 §12.4 |
| Add Proposal | `addMember(groupId, memberKeyPackage)` | RFC 9420 §12.1.1 |
| Remove Proposal | `removeMember(groupId, leafIndex)` | RFC 9420 §12.1.2 |
| Commit Processing | `processCommit(groupId, commitBytes)` | RFC 9420 §12.4 |
| Application Message | `encryptMessage()` / `decryptMessage()` | RFC 9420 §15 |
| Key Schedule | Epoch-based derivation | RFC 9420 §8 |

## Ciphersuite Reference

### MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519 (0x0003)

| Property | Value | Standard |
| --- | --- | --- |
| Ciphersuite ID | 0x0003 | RFC 9420 |
| KEM | DHKEM(X25519, HKDF-SHA256) | RFC 7748, RFC 9180 |
| AEAD | ChaCha20Poly1305 | RFC 8439 |
| Hash | SHA256 | FIPS 180-4 |
| Signature | Ed25519 | RFC 8032 |
| Init Key Size | 32 bytes | |
| Leaf Key Size | 32 bytes | |
| Secret Size | 32 bytes | |
| KEM Public Key Size | 32 bytes | |
| KEM Secret Size | 32 bytes | |
| Signature Public Key Size | 32 bytes | |
| Signature Size | 64 bytes | |

## Notes

- All cryptographic operations use Web Crypto API (`crypto.getRandomValues()`) for secure randomness.
- Private keys are generated client-side and never leave the device.
- Service operates with zero knowledge of message content.
- Evidence should be retained per SOC2 examination requirements.
- Future enhancement: X-Wing hybrid post-quantum ciphersuite for quantum resistance.
