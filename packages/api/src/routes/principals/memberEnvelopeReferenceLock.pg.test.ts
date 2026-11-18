import { expect, test } from "bun:test";
import { getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/test-utils";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { requestPreparedPrincipalPolicy } from "../../../test/helpers/principalHistoryRequest";
import {
  buildOrganizationGroupDeletionRequest,
  getDefaultOrganizationId,
} from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticateUsers } from "../../../test/helpers/principalPolicyReadFixtures";
import { lockPrincipalMutationInTransaction } from "../../workflows/principals/principalMutationLock";

/** A leg citing a predecessor the server never stored, sent as changes. */
function unknownPredecessor(
  leg: PutPrincipalPolicyRequest,
): PutPrincipalPolicyRequest {
  return {
    ...leg,
    memberEnvelopeChanges: { removeUserIds: [], upsert: [] },
    memberEnvelopes: [],
    state: { ...leg.state, prevStateHash: "0".repeat(64) },
  };
}

/**
 * While another directory write holds the organization lock, a write sent
 * by reference must wait for it before it reads any predecessor (#2903 P17):
 * it answers only once the lock is released.
 */
async function expectRebuildWaitsForLock(
  organizationId: string,
  send: () => Promise<Response>,
): Promise<void> {
  const lock = await holdPostgresLock((tx) =>
    lockPrincipalMutationInTransaction(tx, "organization", organizationId),
  );
  let answered = false;
  const response = send().then((value) => {
    answered = true;
    return value;
  });
  try {
    await waitForPostgresLockWait({
      blockerPid: lock.backendPid,
      queryFragment: "pg_advisory_xact_lock",
    });
    expect(answered).toBe(false);
  } finally {
    await lock.release();
  }
  const answer = await response;
  expect(answer.status).toBe(409);
  expect(await answer.json()).toEqual({
    error: "Member envelope changes cite an unknown predecessor state",
  });
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "an organization put and a group delete rebuild only under the organization lock",
  async () => {
    const user = createTestUser();
    await registerAndAuthenticateUsers(user);
    const organizationId = await getDefaultOrganizationId(user.userId);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${user.token}`,
    };
    const groupId = crypto.randomUUID();
    const created = await requestPreparedPrincipalPolicy(
      `/organizations/${organizationId}/groups`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(
          await createGroupRequest({ actor: user, groupId, name: "Operators" }),
        ),
      },
    );
    expect(created.status).toBe(200);
    await created.arrayBuffer();
    const deletion = await buildOrganizationGroupDeletionRequest({
      actor: user,
      groupId,
      organizationId,
    });
    await expectRebuildWaitsForLock(organizationId, () =>
      requestPreparedPrincipalPolicy(
        `/organizations/${organizationId}/groups/${groupId}`,
        {
          method: "DELETE",
          headers,
          body: JSON.stringify({
            organizationPolicy: unknownPredecessor(deletion.organizationPolicy),
          }),
        },
      ),
    );
    await expectRebuildWaitsForLock(organizationId, () =>
      requestPreparedPrincipalPolicy(
        `/principals/organization/${organizationId}/policy`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify(unknownPredecessor(deletion.organizationPolicy)),
        },
      ),
    );
  },
  30_000,
);
