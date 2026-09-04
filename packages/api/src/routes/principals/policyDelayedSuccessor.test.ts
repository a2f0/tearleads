import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { verifyPrincipalPolicyBundle } from "@tearleads/crypto";
import {
  isCommitOrganizationGroupPolicyResponse,
  isPrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  addUserToAdminGroup,
  getCurrentOrganizationAdminAuthority,
} from "../../../test/helpers/organizationAdmin";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import {
  createSignedPrincipalState,
  getDefaultOrganizationId,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { toPrincipalStateExternalAuthority } from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("an honest group history remains readable across an intervening Admins advance", async () => {
  const actor = createTestUser();
  const replacement = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  await registerUser(replacement);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const groupId = crypto.randomUUID();
  const created = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(
        await createGroupRequest({
          actor,
          groupId,
          includeActorAsAdmin: false,
          name: "Delayed group",
        }),
      ),
    },
  );
  expect(created.status).toBe(200);

  async function fetchPolicy(principalId: string) {
    const response = await routeApp.request(
      `/principals/group/${principalId}/policy`,
      { headers: { Authorization: `Bearer ${actor.token}` } },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    invariant(isPrincipalPolicyBundleResponse(body), "expected policy bundle");
    return body;
  }

  const initial = await fetchPolicy(groupId);
  const signerPublicKeys = [actor, replacement].map((user) => ({
    userId: user.userId,
    signingKeyFingerprint: user.fingerprint,
    signingPublicKey: user.signing.signingPublicKey,
  }));
  async function verifyAtInitialCheckpoint() {
    const authority =
      await getCurrentOrganizationAdminAuthority(organizationId);
    const admins = await verifyPrincipalPolicyBundle({
      bundle: await fetchPolicy(authority.principalId),
      signerPublicKeys,
    });
    invariant(admins.ok, "expected verified Admins history");
    return verifyPrincipalPolicyBundle({
      bundle: await fetchPolicy(groupId),
      signerPublicKeys,
      externalAuthority: {
        currentHead: authority,
        states: (admins.value.history ?? []).map((entry) => ({
          head: toPrincipalStateExternalAuthority(entry.state),
          projection: entry.projection,
        })),
      },
      localCheckpoint: {
        principalType: "group",
        principalId: groupId,
        version: initial.currentState.version,
        stateHash: initial.currentState.stateHash,
      },
    });
  }

  async function advanceGroup() {
    const previous = await fetchPolicy(groupId);
    const successor = await createSignedPrincipalState({
      externalAuthority:
        await getCurrentOrganizationAdminAuthority(organizationId),
      keyEpoch: previous.currentState.keyEpoch + 1,
      members: [],
      projection: [],
      prevStateHash: previous.currentState.stateHash,
      principalId: groupId,
      principalType: "group",
      signerUserId: actor.userId,
      signerUserKeyFingerprint: actor.fingerprint,
      signingPrivateKey: actor.signing.signingPrivateKey,
      version: previous.currentState.version + 1,
    });
    const response = await submitOrganizationGroupPolicyCommit({
      actor,
      groupId,
      groupPolicy: successor,
      organizationId,
    });
    expect(response.status).toBe(200);
    expect(isCommitOrganizationGroupPolicyResponse(await response.json())).toBe(
      true,
    );
  }

  expect((await verifyAtInitialCheckpoint()).ok).toBe(true);
  await advanceGroup();
  await addUserToAdminGroup({ actor, member: replacement, organizationId });
  // The device missed the group successor before Admins advanced. Its old
  // checkpoint must accept that successor, and later chains containing it.
  expect((await verifyAtInitialCheckpoint()).ok).toBe(true);
  await advanceGroup();
  const final = await verifyAtInitialCheckpoint();
  invariant(final.ok, "expected delayed history to verify");
  expect(final.value.version).toBe(initial.currentState.version + 2);
});
