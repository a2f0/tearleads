# Principal policy commit outcomes

A client may lose an HTTP response after a standalone organization policy or a
compound group-and-organization policy request commits. Retrying the exact
request returns its original acknowledgement even after later policy versions
commit. A durable receipt is written in the same transaction as the policies and
binds the entire canonical request, authenticated requester, organization, and
compound group when applicable. Separate hash domains distinguish standalone and
compound requests. Existing mutation locks serialize concurrent exact retries.
A replay does not change current heads or publish another access or sharing
notification.

These receipts report historical outcomes; they do not establish current
authority or authorize a newly constructed request. The authenticated requester
must still be a current organization administrator to read a receipt; a revoked
requester receives 403, not a claim that the commit rolled back. Reading an
existing acknowledgement does not require current sync entitlement or rerun
roster billing checks: it reports a past commit without authorizing another.
Invalid stored
receipts fail closed. Compound container results still require their original
acknowledgement rows, so purging an organization cannot leave a response in an
embedded copy. Group deletion removes that group's compound receipts;
organization purge also removes standalone receipts. A null receipt group ID
identifies the standalone organization request domain.

The schema change regenerates both greenfield baselines and requires fresh
databases under the repository reset policy; there is no historical upgrade.
Clients must preserve the authored request while its outcome is unknown.
Durable client retry orchestration remains separate work; these server receipts
do not complete #2442 or #2448.

Receipts survive until their group or organization is deleted. Expiring them on
a time limit would make an old unknown outcome indistinguishable from a failed
commit. Each receipt stores only one or two exact public state references. Replay
loads the immutable state and its public artifacts and reconstructs retired member
envelopes from the authenticated, hash-matched original request. The receipt keeps
no payload, envelope, projection, grant or container-result copy. Rotation can
therefore remove superseded envelope rows without losing the original
acknowledgement. Reference substitution or missing immutable state fails closed.
Reconstructed signature bytes, ciphertext, projection and grants must match the
receipt-authenticated original request; the state hash alone cannot authenticate
signature bytes. Altered retired artifacts cannot return a successful receipt.
Storage still grows by a fixed-size record per accepted commit; durable client
outcome handling remains follow-up work.
