# Principal key envelope candidates

Paged principal recovery stores the current encrypted member envelopes with its
completed prefix. Container key unwrapping can use those envelopes without
materializing a full policy history. The local lookup selects only the requested
principal-key fingerprints from current bundles, retained bundles, completed
prefixes and stages, and the encrypted envelope archive. It selects at most one
candidate per source and fingerprint and removes duplicate encoded candidates.
SQLite indexes cover the fingerprint and newest-candidate ordering. The archive
preserves distinct key epochs while disposable stages are reclaimed; see
[cache retention](principal-history-cache.md) for its limits.

These are untrusted encrypted key candidates, not authorization evidence. A
claimed fingerprint does not establish that a candidate private key is valid:
that key must actually open the requested recipient wrap. Container projection
verification independently checks signed policy authority, the KEK material
identity, and the signed wrapping public key. This lookup never creates a
verified policy, advances a checkpoint, or accepts a prefix as a trust anchor.

The lookup does not read `previous_states_json` or return policy histories.
Malformed JSON is excluded by the fingerprint index expression; malformed
envelope objects are ignored. The principal-history verifier still authenticates
its saved prefix and current artifacts when recovering policy authority.

The regression uses a substituted candidate whose metadata claims the requested
fingerprint but whose member envelope holds a different private key. It cannot
open the object wrap. The correct paged candidate can, including on a fresh SDK
database during the real HTTP cold-decryption diagnostic.
