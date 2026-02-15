# End-to-End Encryption Procedure (HIPAA)

<!-- COMPLIANCE_SENTINEL: TL-HE2E-001 | policy=compliance/HIPAA/policies/05-end-to-end-encryption-policy.md | procedure=compliance/HIPAA/procedures/05-end-to-end-encryption-procedure.md | control=mls-group-encryption -->
<!-- COMPLIANCE_SENTINEL: TL-HE2E-002 | policy=compliance/HIPAA/policies/05-end-to-end-encryption-policy.md | procedure=compliance/HIPAA/procedures/05-end-to-end-encryption-procedure.md | control=mls-key-management -->
<!-- COMPLIANCE_SENTINEL: TL-HE2E-003 | policy=compliance/HIPAA/policies/05-end-to-end-encryption-policy.md | procedure=compliance/HIPAA/procedures/05-end-to-end-encryption-procedure.md | control=mls-forward-secrecy -->
<!-- COMPLIANCE_SENTINEL: TL-HE2E-004 | policy=compliance/HIPAA/policies/05-end-to-end-encryption-policy.md | procedure=compliance/HIPAA/procedures/05-end-to-end-encryption-procedure.md | control=mls-local-storage -->

## Frequency

- Execute at least annually per 164.308(a)(8) (Evaluation) requirements.
- Execute after any changes to the `@tearleads/mls-chat` package cryptographic implementation.
- Execute after ciphersuite updates or cryptographic library upgrades.
- Execute after any security incident involving messaging encryption.

## Procedure Steps

1. Verify MLS ciphersuite configuration meets 164.312(a)(2)(iv) encryption requirements.
2. Verify key generation uses cryptographically secure random sources per 164.312(d).
3. Verify private keys are stored only on client devices per 164.312(a)(2)(iv).
4. Verify epoch-based key evolution provides forward secrecy per 164.312(e)(1).
5. Verify message authentication via Ed25519 signatures per 164.312(c)(1).
6. Verify IndexedDB storage implementation for local key protection per 164.312(a)(2)(iv).
7. Record evidence (configuration state, test results, reviewer).

## Verification Commands

### 164.312(a)(2)(iv): Encryption Implementation (TL-HE2E-001)

```bash
# Verify ciphersuite constant in MLS client
grep -n "MLS_CIPHERSUITE" packages/mls-chat/src/lib/mls.ts

# Verify ChaCha20-Poly1305 is the configured AEAD
grep -n "CHACHA20POLY1305" packages/mls-chat/src/lib/mls.ts

# Verify ciphersuite ID matches RFC 9420 0x0003
grep -n "0x0003" packages/mls-chat/src/lib/mls.ts

# Run MLS encryption unit tests
pnpm --filter @tearleads/mls-chat test -- --grep "encrypt"
```

### 164.312(d): Key Generation and Authentication (TL-HE2E-002)

```bash
# Verify crypto.getRandomValues usage for key generation
grep -n "crypto.getRandomValues" packages/mls-chat/src/lib/mls.ts

# Verify credential generation implementation
grep -n "generateCredential" packages/mls-chat/src/lib/mls.ts

# Verify key package generation
grep -n "generateKeyPackage" packages/mls-chat/src/lib/mls.ts

# Run credential generation tests
pnpm --filter @tearleads/mls-chat test -- --grep "credential"
```

### 164.312(e)(1): Forward Secrecy (TL-HE2E-003)

```bash
# Verify epoch tracking in group state
grep -n "epoch" packages/mls-chat/src/lib/mls.ts

# Verify key evolution on commit processing
grep -n "processCommit" packages/mls-chat/src/lib/mls.ts

# Verify epoch advancement on member changes
grep -n "addMember\|removeMember" packages/mls-chat/src/lib/mls.ts

# Run epoch evolution tests
pnpm --filter @tearleads/mls-chat test -- --grep "epoch"
```

### 164.312(a)(2)(iv): Local Key Storage (TL-HE2E-004)

```bash
# Verify IndexedDB storage implementation
grep -n "IndexedDB\|openDB\|IDBPDatabase" packages/mls-chat/src/lib/storage.ts

# Verify credentials store
grep -n "credentials" packages/mls-chat/src/lib/storage.ts

# Verify key packages store
grep -n "keyPackages" packages/mls-chat/src/lib/storage.ts

# Verify group states store
grep -n "groupStates" packages/mls-chat/src/lib/storage.ts

# Verify private keys are not exported to server
grep -rn "privateKey" packages/mls-chat/src/lib/ | grep -v "test"

# Run storage tests
pnpm --filter @tearleads/mls-chat test -- --grep "storage"
```

### 164.312(c)(1): Message Integrity (TL-HE2E-001)

```bash
# Verify authenticated encryption in message processing
grep -n "authenticatedData\|DecryptedContent" packages/mls-chat/src/lib/mls.ts

# Verify signature types (Ed25519)
grep -n "Ed25519" packages/mls-chat/src/lib/mls.ts

# Run integrity verification tests
pnpm --filter @tearleads/mls-chat test -- --grep "integrity\|authenticate"
```

## Ciphersuite Verification Checklist

| Component | Expected Value | Verification |
| --- | --- | --- |
| Ciphersuite ID | 0x0003 | `grep "0x0003" packages/mls-chat/src/lib/mls.ts` |
| Ciphersuite Name | MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519 | `grep "DHKEMX25519" packages/mls-chat/src/lib/mls.ts` |
| KEM | X25519 | RFC 7748 curve25519 ECDH |
| AEAD | ChaCha20-Poly1305 | RFC 8439 |
| Hash | SHA-256 | FIPS 180-4 |
| Signature | Ed25519 | RFC 8032 |

## RFC 9420 Compliance Verification

```bash
# Verify MLS protocol operations are implemented
echo "=== RFC 9420 Core Operations ==="
grep -c "createGroup" packages/mls-chat/src/lib/mls.ts
grep -c "joinGroup" packages/mls-chat/src/lib/mls.ts
grep -c "addMember" packages/mls-chat/src/lib/mls.ts
grep -c "removeMember" packages/mls-chat/src/lib/mls.ts
grep -c "encryptMessage" packages/mls-chat/src/lib/mls.ts
grep -c "decryptMessage" packages/mls-chat/src/lib/mls.ts
grep -c "processCommit" packages/mls-chat/src/lib/mls.ts

# Verify key schedule operations
echo "=== Key Schedule ==="
grep -c "epoch" packages/mls-chat/src/lib/mls.ts

# Verify credential handling
echo "=== Credentials ==="
grep -c "credential\|Credential" packages/mls-chat/src/lib/mls.ts
```

## Test Coverage Verification

```bash
# Run full test suite with coverage
pnpm --filter @tearleads/mls-chat test:coverage

# Verify coverage thresholds
cat packages/mls-chat/vitest.config.ts | grep -A5 "coverage"
```

## Evidence Template

- Review date:
- Reviewer:
- Package version (`packages/mls-chat/package.json`):
- RFC 9420 compliance level:
- Controls verified:
  - 164.312(a)(2)(iv): `TL-HE2E-001`, `TL-HE2E-004`
  - 164.312(c)(1): `TL-HE2E-001`
  - 164.312(d): `TL-HE2E-002`
  - 164.312(e)(1): `TL-HE2E-003`
- Verification commands run:
- Ciphersuite verification:
  - Ciphersuite ID (0x0003): [PASS/FAIL]
  - X25519 KEM: [PASS/FAIL]
  - ChaCha20-Poly1305 AEAD: [PASS/FAIL]
  - SHA-256 Hash: [PASS/FAIL]
  - Ed25519 Signature: [PASS/FAIL]
- Implementation verification:
  - MLS group encryption (164.312(a)(2)(iv)): [PASS/FAIL]
  - Key generation (164.312(d)): [PASS/FAIL]
  - Forward secrecy (164.312(e)(1)): [PASS/FAIL]
  - Local storage (164.312(a)(2)(iv)): [PASS/FAIL]
  - Message integrity (164.312(c)(1)): [PASS/FAIL]
- Test coverage percentage:
- Exceptions or remediation tasks:
