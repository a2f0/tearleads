# Container grant scope

[`ContainerGrantScope.tla`](./ContainerGrantScope.tla) models the accepted
container-grant domain. A grant request may name any principal, since a client
chooses what it signs; the API's refusals decide what lands. TLC checks that
every reachable grant names either a group in the container's organization or
an active direct user in that organization, and that an organization principal
is never a container grant subject. Roster removal is a guarded transition: a
user must first be unshared from every directly granted container, whose revoke
is a container KEK rotation in the runtime and in the keyring model.

| Model action or predicate | Production seam |
| --- | --- |
| `Grant` / `CheckGrantSubjectType` | `normalizeContainerGrantSubjectType` admits only user and group subjects in the signed grant grammar |
| `CheckGrantOrganization` | `assertVerifiedContainerGrantReferencesValid` locks each referenced group and refuses one outside the container's organization |
| `CheckActiveRoster` | `assertVerifiedContainerGrantReferencesValid` refuses a direct user without an active roster entry in the container's organization |
| `DisableUser` / `BlockDisableWithGrant` | `assertOrganizationUsersHaveNoCurrentDirectContainerGrants` refuses the Members transition while a current direct grant names the user |
| `Revoke` | a direct or group grant removal through `normalizeContainerAccessEventBody`, which rotates the container KEK |

Each refusal is a parameter with a registered negative control:

- `CheckGrantSubjectType = FALSE` grants an organization principal, violating
  `NoOrganizationGrants`.
- `CheckGrantOrganization = FALSE` grants another organization's group,
  violating `GrantsStayWithinOrganization`.
- `CheckActiveRoster = FALSE` grants a disabled user, and
  `BlockDisableWithGrant = FALSE` disables a user who still holds a direct
  grant; both violate `DirectUserGrantsRequireActiveRoster`.

The bounded configuration includes same- and foreign-organization users,
groups, and organization principals. Grant preparation and roster removal are
atomic transitions, with no concurrent transaction model; the API takes the
group and user references under the organization lock. Group membership, and
the cascade that removes a disabled user from groups, is outside this model.
