import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalMembershipProjection,
  principalStatePayloads,
  principalStates,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { PrincipalPolicyMutationResponseSchema } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { prepareOrganizationPolicyAdvance } from "../../../test/helpers/organizationPolicyOutcome";
import { requestPreparedPrincipalPolicy } from "../../../test/helpers/principalHistoryRequest";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";

test.each(["signature", "payload", "projection", "grants"] as const)(
  "receipt replay refuses altered retired %s artifacts",
  async (artifact) => {
    const actor = createTestUser();
    await registerAndAuthenticate(actor);
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
    const advanced = await requestPreparedPrincipalPolicy(
      later.path,
      later.init,
    );
    expect(advanced.status).toBe(200);
    await advanced.arrayBuffer();
    const stateHash = first.currentState.stateHash;
    const scope = {
      principalType: "organization" as const,
      principalId: organizationId,
      stateHash,
    };
    const injectedId = crypto.randomUUID();
    const [stored] = await db
      .select({ containerGrants: principalStates.containerGrants })
      .from(principalStates)
      .where(eq(principalStates.stateHash, stateHash));
    if (!stored) throw new Error("Missing stored principal state");
    try {
      if (artifact === "signature")
        await db
          .update(principalStates)
          .set({ signature: later.body.state.signature })
          .where(eq(principalStates.stateHash, stateHash));
      if (artifact === "payload")
        await db
          .update(principalStatePayloads)
          .set({ ciphertext: "altered-retired-payload" })
          .where(eq(principalStatePayloads.stateHash, stateHash));
      if (artifact === "projection")
        await db.insert(principalMembershipProjection).values({
          ...scope,
          id: injectedId,
          userId: crypto.randomUUID(),
          role: "member",
        });
      if (artifact === "grants")
        await db
          .update(principalStates)
          .set({
            containerGrants: [
              ...stored.containerGrants,
              { accessLevel: "read", containerId: crypto.randomUUID() },
            ],
          })
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
        .set({ signature: first.currentState.signature })
        .where(eq(principalStates.stateHash, stateHash));
      await db
        .update(principalStatePayloads)
        .set({ ciphertext: first.currentPayload.ciphertext })
        .where(eq(principalStatePayloads.stateHash, stateHash));
      await db
        .delete(principalMembershipProjection)
        .where(eq(principalMembershipProjection.id, injectedId));
      await db
        .update(principalStates)
        .set({ containerGrants: stored.containerGrants })
        .where(eq(principalStates.stateHash, stateHash));
    }
    const restored = await requestPreparedPrincipalPolicy(
      original.path,
      original.init,
    );
    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual(first);
  },
  20_000,
);
