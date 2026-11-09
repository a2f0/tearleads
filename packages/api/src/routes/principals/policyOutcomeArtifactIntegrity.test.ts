import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalStates } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { PrincipalPolicyMutationResponseSchema } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { prepareOrganizationPolicyAdvance } from "../../../test/helpers/organizationPolicyOutcome";
import { requestPreparedPrincipalPolicy } from "../../../test/helpers/principalHistoryRequest";
import { registerAndAuthenticateUsers } from "../../../test/helpers/principalPolicyReadFixtures";

test("receipt replay refuses an altered retired state signature", async () => {
  const actor = createTestUser();
  await registerAndAuthenticateUsers(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const original = await prepareOrganizationPolicyAdvance(
    actor,
    organizationId,
  );
  const committed = await requestPreparedPrincipalPolicy(
    original.path,
    original.init,
  );
  expect(committed.status).toBe(200);
  const first = PrincipalPolicyMutationResponseSchema.parse(
    await committed.json(),
  );
  const later = await prepareOrganizationPolicyAdvance(actor, organizationId);
  const advanced = await requestPreparedPrincipalPolicy(later.path, later.init);
  expect(advanced.status).toBe(200);
  await advanced.arrayBuffer();
  const stateHash = first.head.stateHash;
  try {
    await db
      .update(principalStates)
      .set({ signature: later.body.state.signature })
      .where(eq(principalStates.stateHash, stateHash));
    const replay = await requestPreparedPrincipalPolicy(
      original.path,
      original.init,
    );
    expect(replay.status).toBe(409);
    await replay.arrayBuffer();
  } finally {
    await db
      .update(principalStates)
      .set({ signature: original.body.state.signature })
      .where(eq(principalStates.stateHash, stateHash));
  }
  const restored = await requestPreparedPrincipalPolicy(
    original.path,
    original.init,
  );
  expect(restored.status).toBe(200);
  expect(await restored.json()).toEqual({ ...first, containerMutations: [] });
}, 20_000);
