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
| [`src/primitives`](src/primitives/) | AES-256-GCM payloads, SHA-256 fingerprints and incremental hashing, hex encoding, and canonical string ordering |
| [`src/encapsulation`](src/encapsulation/) | ML-KEM key pairs, recipient encryption, and DEK wrapping |
| [`src/signing`](src/signing/) | ML-DSA key pairs, signing, verification, and signature histories |
| [`src/envelopes`](src/envelopes/) | Content-key envelopes, encrypted blob envelopes and content metadata, and encrypted document updates |
| [`src/identity`](src/identity/) | Sign-in challenges, the BIP39 identity seed phrase, identity links, canonical identity trust domains, and identity bundle fingerprints |
| [`src/principalState`](src/principalState/) | Signed group and organization principal state, container grants, and member envelopes |
| [`src/organization`](src/organization/) | Encrypted group metadata and signed organization leave and replacement requests |
| [`src/keying`](src/keying/) | The keying protocol's signed artifacts and their verifiers; [`index.ts`](src/keying/index.ts) lists its public functions |

The keying folders:

| Path | Contents |
| --- | --- |
| [`src/keying/core`](src/keying/core/) | Canonical encoding and hash domains, shared field readers, and verification errors |
| [`src/keying/access`](src/keying/access/) | Access events, access manifests and their snapshots, local checkpoints, and held writer projection citations |
| [`src/keying/containerAccess`](src/keying/containerAccess/) | Container access manifests: grants, moves, rekeys, recitations, parent edges, and path access levels |
| [`src/keying/containerKek`](src/keying/containerKek/README.md) | Container KEK state, wrapping, keyrings, and content-key target derivations |
| [`src/keying/documentAccess`](src/keying/documentAccess/) | Document link sets, citation scopes, write authority, purges, and attachment bindings |
| [`src/keying/principalPolicy`](src/keying/principalPolicy/) | Principal policy bundles, chain entries, transitions, signatures, and authorization selection |
| [`src/keying/principalPolicyCurrent`](src/keying/principalPolicyCurrent/) | The current principal policy and its mutation, successor, and predecessor-reference checks |
| [`src/keying/principalPolicyHistory`](src/keying/principalPolicyHistory/) | The principal policy history verifier, its index, pages, progress, and reference proofs |
| [`src/keying/transparency`](src/keying/transparency/) | Transparency leaves, Merkle trees, proofs, and signed tree heads |
| [`src/keying/writeHeader`](src/keying/writeHeader/) | Signed document and blob write headers and their authorization |
| [`src/keying/properties`](src/keying/properties/) | Property-based tests over generated keying histories |

A new module goes in the folder for its artifact, not in `src` or
`src/keying` directly.

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
