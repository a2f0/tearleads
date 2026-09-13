# Organization Scope

[OrganizationScope.tla](./OrganizationScope.tla) models finding 19 of #2266.
A group signature proves a principal history, while the separately signed
organization directory binds its head to the expected organization. A cache
warm attempt needs both. A historical reference can use the verified history
below that directory head; requiring the reference itself to equal the newest
head would prevent an honest delayed container from recovering its group key.

| Model action or predicate | Production seam |
| --- | --- |
| `WarmPolicy` | `scopeReferencedPolicyForCache`, `cachePrincipalPolicyBundle` |
| `DirectoryBindsChain` | `directoryBindsGroupReference`, `principalHeadMatchesReference` |
| `HasScopeProof` | `createPolicyDirectoryLoader`, `verifyOrganizationAdminPolicy` |
| `ChooseParent` | `requireContainerPathCurrentParent` |
| `ParentEdgesStayInOrganization` | `verifyContainerAccessManifest` |

The bounds include two organizations, two group versions, a verified two-state
chain, a historical or current reference, and either organization as a parent.
TLC explores cache warming and parent selection in either order. Four negative
controls remove directory identity, directory-head, or parent-scope checks, or
add an invalid current-reference requirement. The expected invariants fail.

Signatures, exact hash comparisons, payload commitments, checkpoint lineage,
and transactional cache persistence are abstracted as verified inputs and
checked by runtime regressions. Missing or concurrently changing directory
material is a cache miss; the model does not promise network availability or
semantic currency against a dishonest server. Cache scope validation does not
replace read-time authorization at the historical membership a manifest cited.
