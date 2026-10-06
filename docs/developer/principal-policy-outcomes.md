# Principal policy commit outcomes

A client may lose the HTTP response after both the group and organization
policies commit. Retrying the exact compound request returns its original
acknowledgement even after later policy versions commit. A durable receipt is
written in the same transaction as both policies and binds the entire canonical
request, authenticated requester, organization, and group. A concurrent exact
retry is serialized by the existing organization/group mutation locks. A replay
does not change the current heads or send another sharing notification.

These receipts report historical outcomes; they do not establish current
authority or authorize a newly constructed request. Invalid stored receipts
fail closed. Container results still require their original acknowledgement
rows, so container purge cannot resurrect a response from an embedded copy.
Group deletion and organization purge remove their compound receipts.
The schema change regenerates both greenfield baselines and requires fresh
databases under the repository reset policy; there is no historical upgrade.

Clients must preserve the authored request while its outcome is unknown.
Standalone writes and durable client retry orchestration remain separate work;
this compound server receipt does not complete #2442 or #2448.
