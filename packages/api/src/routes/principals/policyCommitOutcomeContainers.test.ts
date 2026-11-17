import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalPolicyCommits,
  principalPolicyMutationAcknowledgements,
} from "@tearleads/api-shared/schema";
import { isCommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { prepareRotation } from "../../../test/helpers/policyRotationFixture";
import { requestPreparedPrincipalPolicy } from "../../../test/helpers/principalHistoryRequest";
import {
  getDefaultOrganizationId,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";

test("compound replay matches the original container acknowledgements by their request commitment", async () => {
  const prepared = await prepareRotation();
  const groupId = prepared.nextPolicy.principalId;
  let original: { path: string; init: RequestInit } | undefined;
  const response = await submitOrganizationGroupPolicyCommit({
    actor: prepared.owner,
    groupId,
    organizationId: await getDefaultOrganizationId(prepared.owner.userId),
    groupPolicy: {
      ...prepared.signed,
      containerMutations: prepared.containerMutations,
    },
    request: (path, init) => {
      original = { path, init };
      return requestPreparedPrincipalPolicy(path, init);
    },
  });
  expect(response.status).toBe(200);
  const committed: unknown = await response.json();
  if (!isCommitOrganizationGroupPolicyResponse(committed) || !original)
    throw new Error("Missing compound outcome");
  expect(committed.groupPolicy.containerMutations.length).toBeGreaterThan(0);
  const replay = await requestPreparedPrincipalPolicy(
    original.path,
    original.init,
  );
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(committed);
  const [receipt] = await db
    .select()
    .from(principalPolicyCommits)
    .where(eq(principalPolicyCommits.groupId, groupId));
  if (!receipt) throw new Error("Missing stored compound receipt");
  expect(receipt.responseJson.length).toBeLessThan(1_024);
  expect(receipt.responseJson).not.toContain("containerMutations");
  // Each acknowledgement keeps a commitment to its request, not the request,
  // and a replay must match it.
  const acknowledgements = await db
    .select({
      containerId: principalPolicyMutationAcknowledgements.containerId,
      requestSha256: principalPolicyMutationAcknowledgements.requestSha256,
    })
    .from(principalPolicyMutationAcknowledgements)
    .where(eq(principalPolicyMutationAcknowledgements.principalId, groupId));
  expect(acknowledgements.length).toBe(
    committed.groupPolicy.containerMutations.length,
  );
  for (const { requestSha256 } of acknowledgements)
    expect(requestSha256).toMatch(/^[0-9a-f]{64}$/);
  await db
    .update(principalPolicyMutationAcknowledgements)
    .set({ requestSha256: "0".repeat(64) })
    .where(eq(principalPolicyMutationAcknowledgements.principalId, groupId));
  const altered = await requestPreparedPrincipalPolicy(
    original.path,
    original.init,
  );
  expect(altered.status).toBe(409);
  expect(await altered.json()).toEqual({
    error:
      "Principal policy container replay does not match its committed acknowledgement",
  });
  await db
    .delete(principalPolicyMutationAcknowledgements)
    .where(
      eq(
        principalPolicyMutationAcknowledgements.containerId,
        prepared.root.kekState.containerId,
      ),
    );
  const missing = await requestPreparedPrincipalPolicy(
    original.path,
    original.init,
  );
  expect(missing.status).toBe(409);
  expect(await missing.json()).toEqual({
    error: "Principal policy container replay batch is incomplete",
  });
});
