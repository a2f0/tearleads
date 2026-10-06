# Principal key envelope candidates

Paged principal recovery stores the current encrypted member envelopes with its
completed prefix. Container key unwrapping can use those envelopes without
materializing a full policy history. The local lookup selects only the requested
recipient fingerprints from the current bundle, retained bundle, and completed
prefix caches, with at most one candidate per cache and fingerprint. SQLite
expression indexes cover the fingerprint and newest-candidate ordering.

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
