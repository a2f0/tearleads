# End-to-End Encryption Technical Control Map (NIST SP 800-53)

This map ties end-to-end encryption policy controls to concrete implementation and test evidence, aligned with NIST SP 800-53 Revision 5 requirements.

> **Implementation Status**: The `@tearleads/mls-chat` package currently provides a placeholder implementation with the MLS protocol interface. Full RFC 9420 compliance with production-grade cryptography is planned via ts-mls library integration. Controls marked "Planned" are not yet cryptographically compliant.

## Sentinel Controls

| Sentinel | NIST Control | Status | Description | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- | --- | --- |
| `TL-NE2E-001` | SC-8, SC-13, SI-7 | Planned | MLS group encryption with ChaCha20-Poly1305 | [`packages/mls-core/src/mls.ts`](../../../packages/mls-core/src/mls.ts) | `pnpm --filter @tearleads/mls-chat test -- --grep "encrypt"` |
| `TL-NE2E-002` | SC-12, IA-5 | Planned | Ed25519 credential and key package management | [`packages/mls-core/src/mls.ts`](../../../packages/mls-core/src/mls.ts) (generateCredential, generateKeyPackage) | `pnpm --filter @tearleads/mls-chat test -- --grep "credential"` |
| `TL-NE2E-003` | SC-8(1) | Planned | Epoch-based key evolution for forward secrecy | [`packages/mls-core/src/mls.ts`](../../../packages/mls-core/src/mls.ts) (processCommit, epoch tracking) | `pnpm --filter @tearleads/mls-chat test -- --grep "epoch"` |
| `TL-NE2E-004` | SC-28, SC-12 | Implemented | IndexedDB local storage for private keys | [`packages/mls-core/src/storage.ts`](../../../packages/mls-core/src/storage.ts) | `pnpm --filter @tearleads/mls-chat test -- --grep "storage"` |

## NIST SP 800-53 Rev 5 Control Mapping

### System and Communications Protection (SC)

| Control | Enhancement | Implementation | Sentinel |
| --- | --- | --- | --- |
| SC-8 Transmission Confidentiality | Base | MLS E2E encryption with ChaCha20-Poly1305 AEAD | `TL-NE2E-001` |
| SC-8 Transmission Confidentiality | (1) Cryptographic Protection | Forward secrecy via epoch-based key derivation | `TL-NE2E-003` |
| SC-12 Cryptographic Key Establishment | Base | Ed25519 key generation; MLS key schedule | `TL-NE2E-002`, `TL-NE2E-004` |
| SC-13 Cryptographic Protection | Base | RFC 9420 MLS with approved algorithms | `TL-NE2E-001` |
| SC-28 Protection of Information at Rest | Base | Private keys in IndexedDB, never transmitted | `TL-NE2E-004` |

### Identification and Authentication (IA)

| Control | Enhancement | Implementation | Sentinel |
| --- | --- | --- | --- |
| IA-5 Authenticator Management | Base | MLS credentials with user identity; Ed25519 signed key packages | `TL-NE2E-002` |

### System and Information Integrity (SI)

| Control | Enhancement | Implementation | Sentinel |
| --- | --- | --- | --- |
| SI-7 Software and Information Integrity | Base | AEAD authentication tags; Ed25519 signed commits | `TL-NE2E-001` |

## Control Details

### TL-NE2E-001: Transmission Confidentiality (SC-8, SC-13)

**NIST Requirements Addressed:**

- SC-8: Protect confidentiality and integrity of transmitted information
- SC-13: Implement NIST-approved cryptographic mechanisms

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

### TL-NE2E-002: Cryptographic Key Establishment (SC-12, IA-5)

**NIST Requirements Addressed:**

- SC-12: Establish and manage cryptographic keys
- IA-5: Manage authenticators securely

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

### TL-NE2E-003: Cryptographic Protection with Forward Secrecy (SC-8(1))

**NIST Requirements Addressed:**

- SC-8(1): Implement cryptographic mechanisms to prevent unauthorized disclosure during transmission

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

### TL-NE2E-004: Protection of Information at Rest (SC-28)

**NIST Requirements Addressed:**

- SC-28: Protect confidentiality and integrity of information at rest

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
- Private keys never transmitted to server
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
- Assessment should follow NIST SP 800-53A guidance for control assessment.
- Future enhancement: X-Wing hybrid post-quantum ciphersuite for quantum resistance per ongoing NIST PQC standardization.
