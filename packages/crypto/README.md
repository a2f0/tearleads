# @tearleads/crypto

The cryptography and keying protocol shared by the client SDK and the API:
primitives, key and content envelopes, signed principal state, and the
verifiers for every signed keying artifact. Both sides of the trust boundary
import the same code, so a client and the API agree on each canonical byte
string, hash domain, and signature check. It depends only on
`@tearleads/encoding`, `@tearleads/validators`, and audited `@noble` and
`@scure` libraries.

Public-key operations are post-quantum only: ML-KEM-1024 encapsulates keys and
ML-DSA-87 signs, with AES-256-GCM for payloads and key wrapping. The
[cipher suites](../../docs/cipher-suites.md) reference maps each primitive to
where it is used, and the [keying design](../../docs/keying-design.md) explains
how the pieces fit.

## Layout

| Path | Contents |
| --- | --- |
| [`src/encapsulation`](src/encapsulation/) | ML-KEM key pairs, recipient encryption, and DEK wrapping |
| [`src/signing`](src/signing/) | ML-DSA key pairs, signing, verification, and signature histories |
| [`src/symmetric.ts`](src/symmetric.ts), [`src/contentKeyEnvelope.ts`](src/contentKeyEnvelope.ts), [`src/blobEnvelopeError.ts`](src/blobEnvelopeError.ts), [`src/blobEnvelopeFields.ts`](src/blobEnvelopeFields.ts), [`src/blobEnvelopeReader.ts`](src/blobEnvelopeReader.ts), [`src/blobEnvelopeV2.ts`](src/blobEnvelopeV2.ts) | AES-GCM payloads, content keys, and encrypted blob envelopes |
| [`src/challenge.ts`](src/challenge.ts), [`src/identitySeedPhrase.ts`](src/identitySeedPhrase.ts), [`src/fingerprint.ts`](src/fingerprint.ts) | Sign-in challenges, the BIP39 identity seed phrase, and key fingerprints |
| [`src/principalState.ts`](src/principalState.ts), [`src/principalStateMembers.ts`](src/principalStateMembers.ts), [`src/principalStateTypes.ts`](src/principalStateTypes.ts), [`src/principalStateVerification.ts`](src/principalStateVerification.ts), [`src/principalContainerGrants.ts`](src/principalContainerGrants.ts), [`src/principalMemberEnvelopes.ts`](src/principalMemberEnvelopes.ts), [`src/principalPolicyValidationError.ts`](src/principalPolicyValidationError.ts) | Signed group and organization principal state and member envelopes |
| [`src/keying`](src/keying/) | Canonical encoding, access events and manifests, container KEKs, document access, and principal policy history |
| [`src/keying/containerKek`](src/keying/containerKek/README.md) | Container KEK internals and content-key target derivations |

The root entry point exports the public functions. Keep canonical hashing
domains and exported names stable: signed artifacts already in storage depend
on them. Sort hash-adjacent strings with `compareCanonicalStrings`, never a
locale-dependent comparison (`bun run lint:canonical-ordering` enforces this).

## Test fixtures

The `*-test-fixtures` entry points (for example
`@tearleads/crypto/container-access-test-fixtures`) build signed artifacts for
other packages' tests. Production source must not import them.

## Tests

```sh
bun run --cwd packages/crypto test
```

`bun run --cwd packages/crypto test:principal-history` runs the principal
history availability boundary test on its own.
