# Principal directory binding index

Projection evidence reads one current organization directory and the requested
group heads. A deleted group's last directory citation comes from the indexed
`principal_directory_bindings` table. Looking up a group no longer loads every
historical organization payload. The lookup is bounded by the projection's exact
organization version, including when newer directories exist.

The transaction accepting an organization policy records the first signed
directory citation of each group head. Repeated unchanged directories do not
create another copy. Group deletion retains these public bindings alongside
public group state history. Organization purge removes them. Both greenfield
schema baselines include the table; existing databases require the documented
reset, with no compatibility reader or backfill.

Rows locate evidence and confer no authority. Reads join the exact scoped
organization state, check its payload hash, parse the signed directory, and
compare the group identity, version, and hash. The normal projection verifier
still authenticates the organization's history and group chains. Missing or
inconsistent rows fail closed. This table is a persistent projection of accepted
policy data, separate from disposable verification caches.

The process memo keys organization head and requested group set, returns owned
copies, and retains at most its 32 MiB budget. Clearing it changes only read
cost. Public signed history is delivered through `/principals/history` and
verified by `recoverProjectionPolicyHistory`; the index binds its source heads.
