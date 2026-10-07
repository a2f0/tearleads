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

test("compound replay uses the original container acknowledgements without retaining a second copy", async () => {
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
}, 15_000);
