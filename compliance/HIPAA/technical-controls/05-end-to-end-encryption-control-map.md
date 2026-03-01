# End-to-End Encryption Technical Control Map (HIPAA)

This map ties end-to-end encryption policy controls to concrete implementation and test evidence, aligned with HIPAA Security Rule requirements.

> **Implementation Status**: The `@tearleads/mls-chat` package currently provides a placeholder implementation with the MLS protocol interface. Full RFC 9420 compliance with production-grade cryptography is planned via ts-mls library integration. Controls marked "Planned" are not yet cryptographically compliant.

## Sentinel Controls

| Sentinel | HIPAA Standard | Status | Description | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- | --- | --- |
| `TL-HE2E-001` | 164.312(a)(2)(iv), 164.312(e)(2)(ii) | Planned | MLS group encryption with ChaCha20-Poly1305 | [`packages/mls-core/src/mls.ts`](../../../packages/mls-core/src/mls.ts) | `pnpm --filter @tearleads/mls-chat test -- --grep "encrypt"` |
| `TL-HE2E-002` | 164.312(d), 164.312(c)(2) | Planned | Ed25519 credential and key package management | [`packages/mls-core/src/mls.ts`](../../../packages/mls-core/src/mls.ts) (generateCredential, generateKeyPackage) | `pnpm --filter @tearleads/mls-chat test -- --grep "credential"` |
| `TL-HE2E-003` | 164.312(e)(1) | Planned | Epoch-based key evolution for forward secrecy | [`packages/mls-core/src/mls.ts`](../../../packages/mls-core/src/mls.ts) (processCommit, epoch tracking) | `pnpm --filter @tearleads/mls-chat test -- --grep "epoch"` |
| `TL-HE2E-004` | 164.312(a)(2)(iv) | Implemented | IndexedDB local storage for private keys | [`packages/mls-core/src/storage.ts`](../../../packages/mls-core/src/storage.ts) | `pnpm --filter @tearleads/mls-chat test -- --grep "storage"` |

## HIPAA Security Rule Mapping

### Technical Safeguards (164.312)

| Standard | Implementation Specification | Implementation | Sentinel |
| --- | --- | --- | --- |
| 164.312(a)(2)(iv) Encryption | Addressable | MLS encryption with ChaCha20-Poly1305; IndexedDB key storage | `TL-HE2E-001`, `TL-HE2E-004` |
| 164.312(c)(1) Integrity | Required | Poly1305 authentication tags; Ed25519 signed commits | `TL-HE2E-001` |
| 164.312(c)(2) Authentication | Addressable | Ed25519 signed key packages and credentials | `TL-HE2E-002` |
| 164.312(d) Person Authentication | Required | MLS credentials with user identity; signed key packages | `TL-HE2E-002` |
| 164.312(e)(1) Transmission Security | Required | End-to-end encryption; forward secrecy via epochs | `TL-HE2E-001`, `TL-HE2E-003` |
| 164.312(e)(2)(i) Integrity Controls | Addressable | AEAD authentication; signed group state changes | `TL-HE2E-001` |
| 164.312(e)(2)(ii) Encryption | Addressable | MLS application message encryption | `TL-HE2E-001` |

## Control Details

### TL-HE2E-001: Message Encryption (164.312(a)(2)(iv), 164.312(e)(2)(ii))

**HIPAA Requirements Addressed:**

- 164.312(a)(2)(iv): Implement mechanism to encrypt and decrypt ePHI
- 164.312(e)(2)(ii): Encrypt ePHI during transmission
- 164.312(c)(1): Protect ePHI from improper alteration or destruction
- 164.312(e)(2)(i): Ensure ePHI is not improperly modified during transmission

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

### TL-HE2E-002: Key Management (164.312(d))

**HIPAA Requirements Addressed:**

- 164.312(d): Verify identity of person/entity seeking access to ePHI
- 164.312(c)(2): Mechanisms to authenticate ePHI

**Implementation:**

- `packages/mls-core/src/mls.ts` - Credential and key package generation

**Key Operations:**

- `generateCredential()` - Create Ed25519 identity credential with user binding
- `generateKeyPackage()` - Create signed key package for group invitations
- Key packages signed with Ed25519 private key
- User identity bound to credential for authentication

**Key Material:**

- Private keys: 32 bytes (256-bit), generated via `crypto.getRandomValues()`
- Credential bundle: User identity + public key
- Key package: Public key + lifetime + extensions, signed

### TL-HE2E-003: Forward Secrecy (164.312(e)(1))

**HIPAA Requirements Addressed:**

- 164.312(e)(1): Guard against unauthorized access to ePHI during transmission

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

### TL-HE2E-004: Local Key Storage (164.312(a)(2)(iv))

**HIPAA Requirements Addressed:**

- 164.312(a)(2)(iv): Implement encryption for ePHI at rest

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

| MLS Operation | Implementation | Section |
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

| Property | Value |
| --- | --- |
| Ciphersuite ID | 0x0003 |
| KEM | DHKEM(X25519, HKDF-SHA256) |
| AEAD | ChaCha20Poly1305 |
| Hash | SHA256 |
| Signature | Ed25519 |
| Init Key Size | 32 bytes |
| Leaf Key Size | 32 bytes |
| Secret Size | 32 bytes |
| KEM Public Key Size | 32 bytes |
| KEM Secret Size | 32 bytes |
| Signature Public Key Size | 32 bytes |
| Signature Size | 64 bytes |

## Notes

- All cryptographic operations use Web Crypto API (`crypto.getRandomValues()`) for secure randomness.
- Private keys are generated client-side and never leave the device.
- Evidence should be retained for 6 years per 164.316(b) documentation requirements.
- Controls should be evaluated per 164.308(a)(8) (Evaluation) requirements.
- Future enhancement: X-Wing hybrid post-quantum ciphersuite for quantum resistance.
