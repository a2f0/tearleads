# End-to-End Encryption Procedure (SOC2)

<!-- COMPLIANCE_SENTINEL: TL-E2E-001 | policy=compliance/SOC2/policies/05-end-to-end-encryption-policy.md | procedure=compliance/SOC2/procedures/05-end-to-end-encryption-procedure.md | control=mls-group-encryption -->
<!-- COMPLIANCE_SENTINEL: TL-E2E-002 | policy=compliance/SOC2/policies/05-end-to-end-encryption-policy.md | procedure=compliance/SOC2/procedures/05-end-to-end-encryption-procedure.md | control=mls-key-management -->
<!-- COMPLIANCE_SENTINEL: TL-E2E-003 | policy=compliance/SOC2/policies/05-end-to-end-encryption-policy.md | procedure=compliance/SOC2/procedures/05-end-to-end-encryption-procedure.md | control=mls-forward-secrecy -->
<!-- COMPLIANCE_SENTINEL: TL-E2E-004 | policy=compliance/SOC2/policies/05-end-to-end-encryption-policy.md | procedure=compliance/SOC2/procedures/05-end-to-end-encryption-procedure.md | control=mls-local-storage -->

## Frequency

- Execute at least annually as part of SOC2 examination.
- Execute after any changes to the `@tearleads/mls-chat` package cryptographic implementation.
- Execute after ciphersuite updates or cryptographic library upgrades.
- Execute after any security incident involving messaging encryption.

## Procedure Steps

1. Verify MLS ciphersuite configuration meets encryption requirements (CC6.1, CC6.7).
2. Verify key generation uses cryptographically secure random sources (CC6.1).
3. Verify private keys are stored only on client devices (CC6.1, C1.1).
4. Verify epoch-based key evolution provides forward secrecy (CC6.7).
5. Verify message authentication via AEAD and signatures (PI1.1).
6. Verify IndexedDB storage implementation for local key protection (C1.1).
7. Record evidence (configuration state, test results, reviewer).

## Verification Commands

### CC6.1/CC6.7: Encryption Implementation (TL-E2E-001)

```bash
# Verify ciphersuite constant in MLS client
grep -n "MLS_CIPHERSUITE" packages/mls-chat/src/lib/mls.ts

# Verify ChaCha20-Poly1305 is the configured AEAD (RFC 8439)
grep -n "CHACHA20POLY1305" packages/mls-chat/src/lib/mls.ts

# Verify ciphersuite ID matches RFC 9420 0x0003
grep -n "0x0003" packages/mls-chat/src/lib/mls.ts

# Run MLS encryption unit tests
pnpm --filter @tearleads/mls-chat test -- --grep "encrypt"
```

### CC6.1: Key Management (TL-E2E-002)

```bash
# Verify crypto.getRandomValues usage for secure key generation
grep -n "crypto.getRandomValues" packages/mls-chat/src/lib/mls.ts

# Verify credential generation implementation
grep -n "generateCredential" packages/mls-chat/src/lib/mls.ts

# Verify key package generation with Ed25519 signing
grep -n "generateKeyPackage" packages/mls-chat/src/lib/mls.ts

# Run credential generation tests
pnpm --filter @tearleads/mls-chat test -- --grep "credential"
```

### CC6.7: Forward Secrecy (TL-E2E-003)

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

### C1.1: Local Key Storage (TL-E2E-004)

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

### PI1.1: Message Integrity (TL-E2E-001)

```bash
# Verify authenticated encryption in message processing
grep -n "authenticatedData\|DecryptedContent" packages/mls-chat/src/lib/mls.ts

# Verify signature algorithm (Ed25519 per RFC 8032)
grep -n "Ed25519" packages/mls-chat/src/lib/mls.ts

# Run integrity verification tests
pnpm --filter @tearleads/mls-chat test -- --grep "integrity\|authenticate"
```

## Ciphersuite Verification Checklist

| Component | Algorithm | Standard | Verification |
| --- | --- | --- | --- |
| Ciphersuite ID | 0x0003 | RFC 9420 | `grep "0x0003" packages/mls-chat/src/lib/mls.ts` |
| KEM | X25519 | RFC 7748 | Curve25519 ECDH |
| AEAD | ChaCha20-Poly1305 | RFC 8439 | 256-bit key, 96-bit nonce |
| Hash | SHA-256 | FIPS 180-4 | 256-bit output |
| Signature | Ed25519 | RFC 8032 | 256-bit keys, 512-bit signatures |

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
echo "=== Key Schedule (RFC 9420 Section 8) ==="
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
- Trust Services Criteria verified:
  - CC6.1 (Access Controls): `TL-E2E-001`, `TL-E2E-002`, `TL-E2E-004`
  - CC6.7 (Transmission): `TL-E2E-001`, `TL-E2E-003`
  - C1.1 (Confidentiality): `TL-E2E-001`, `TL-E2E-004`
  - PI1.1 (Integrity): `TL-E2E-001`
- Verification commands run:
- Ciphersuite verification:
  - Ciphersuite ID (0x0003): [PASS/FAIL]
  - X25519 KEM (RFC 7748): [PASS/FAIL]
  - ChaCha20-Poly1305 AEAD (RFC 8439): [PASS/FAIL]
  - SHA-256 Hash (FIPS 180-4): [PASS/FAIL]
  - Ed25519 Signature (RFC 8032): [PASS/FAIL]
- Implementation verification:
  - Message encryption (CC6.1, CC6.7): [PASS/FAIL]
  - Key management (CC6.1): [PASS/FAIL]
  - Forward secrecy (CC6.7): [PASS/FAIL]
  - Confidentiality (C1.1): [PASS/FAIL]
  - Processing integrity (PI1.1): [PASS/FAIL]
- Test coverage percentage:
- Exceptions or remediation tasks:
