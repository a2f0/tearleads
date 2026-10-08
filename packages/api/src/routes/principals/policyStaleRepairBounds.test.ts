import { expect, spyOn, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { isPrincipalPolicyStaleErrorResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import { buildChildCreateRequest } from "../../../test/helpers/containerMutationArtifactKit";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { seedLongPrincipalHistory } from "../../../test/helpers/longPrincipalHistory";
import { startPrincipalHistoryHttpProbe } from "../../../test/helpers/principalHistoryHttpProbe";
import {
  getPolicy,
  registerAndAuthenticate,
} from "../../../test/helpers/principalPolicyReadFixtures";
import * as principalStateStore from "../../access/read/principalStateStore";

test("stale create replies keep response bytes and per-request database work bounded across history depths", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = JSON.stringify(
    await buildChildCreateRequest({ root, signer: owner }),
  );
  const groupId = root.principalPolicies[0]?.principalId;
  invariant(groupId, "Expected Admins policy");
  let policy = await (await getPolicy(owner, "group", groupId)).json();
  const server = startPrincipalHistoryHttpProbe();
  const fullHistoryRead = spyOn(
    principalStateStore,
    "listPrincipalStateHistory",
  );
  try {
    for (const version of [64, 128]) {
      await seedLongPrincipalHistory({
        actor: owner,
        policy,
        throughVersion: version,
      });
      let completed = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const response = await fetch(new URL("/containers", server.url), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${owner.token}`,
          },
          body: request,
          signal: AbortSignal.timeout(15_000),
        });
        const text = await response.text();
        if (response.status === 202) continue;
        expect(response.status, text).toBe(409);
        const body: unknown = JSON.parse(text);
        invariant(
          isPrincipalPolicyStaleErrorResponse(body),
          "Expected compact stale policy response",
        );
        expect(body.principalHeads).toHaveLength(1);
        expect(body.principalHeads[0]).toMatchObject({
          principalId: groupId,
          version,
        });
        expect(new TextEncoder().encode(text).byteLength).toBeLessThan(2048);
        expect(text).not.toContain("previousStates");
        expect(fullHistoryRead).not.toHaveBeenCalled();
        expect(
          server.metrics.maximumDatabaseStatementsPerRequest,
        ).toBeLessThanOrEqual(350);
        completed = true;
        break;
      }
      expect(completed).toBe(true);
      policy = await (await getPolicy(owner, "group", groupId)).json();
    }
  } finally {
    fullHistoryRead.mockRestore();
    await server.stop();
  }
}, 30_000);
