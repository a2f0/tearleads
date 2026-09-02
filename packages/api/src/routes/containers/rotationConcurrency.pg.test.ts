import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { accessManifestHeads } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import {
  CONTAINER_MUTATION_ERROR_CODES,
  type ContainerMutationResponse,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import {
  holdAccessManifestHeadForUpdate,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

const concurrencyTimeoutMs = 30_000;
const RACE_ROUNDS = 3;
type RekeyFixture = Parameters<
  typeof buildRootContainerRekeyMutation
>[0]["previous"];

function postRekey(input: {
  readonly containerId: string;
  readonly request: ContainerMutationRequest;
  readonly token: string;
}): Promise<Response> {
  return Promise.resolve(
    routeApp.request(`/containers/${input.containerId}/rekey`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.request),
    }),
  );
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "concurrent container rotations commit exactly one winner",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    let current: RekeyFixture = await bootstrapRoot(owner);

    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const candidates = await Promise.all([
        buildRootContainerRekeyMutation({ previous: current, signer: owner }),
        buildRootContainerRekeyMutation({ previous: current, signer: owner }),
      ]);
      const headLock = await holdAccessManifestHeadForUpdate({
        objectId: current.kekState.containerId,
        objectKind: "container",
      });
      const contenders: Promise<Response>[] = [];
      let synchronizationError: unknown;
      try {
        contenders.push(
          postRekey({
            containerId: current.kekState.containerId,
            request: candidates[0].request,
            token: owner.token,
          }),
        );
        await waitForPostgresLockWait({
          blockerPid: headLock.backendPid,
          queryFragment: "access_manifest_heads",
        });
        contenders.push(
          postRekey({
            containerId: current.kekState.containerId,
            request: candidates[1].request,
            token: owner.token,
          }),
        );
        await waitForPostgresLockWait({
          blockerPid: headLock.backendPid,
          queryFragment: "organization_read_model_heads",
        });
      } catch (error) {
        synchronizationError = error;
      } finally {
        await headLock.release();
      }
      const responses = await Promise.all(contenders);
      if (synchronizationError) {
        throw synchronizationError;
      }
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      const winnerIndex = responses.findIndex(
        (response) => response.status === 200,
      );
      const loserIndex = winnerIndex === 0 ? 1 : 0;
      const winner = candidates[winnerIndex];
      const loserResponse = responses[loserIndex];
      if (!winner || !loserResponse) {
        throw new Error("Expected one rotation winner and one loser");
      }
      expect(await loserResponse.json()).toEqual({
        code: CONTAINER_MUTATION_ERROR_CODES.stateStale,
        error: "previousContainerPath[0] manifest head is stale",
      });
      const winnerResponse = (await responses[winnerIndex]?.json()) as
        | ContainerMutationResponse
        | undefined;
      expect(winnerResponse?.manifestHead.manifestHash).toBe(
        winner.request.expectedManifestHash,
      );

      const [head] = await db
        .select({ manifestHash: accessManifestHeads.manifestHash })
        .from(accessManifestHeads)
        .where(
          and(
            eq(accessManifestHeads.objectKind, "container"),
            eq(accessManifestHeads.objectId, current.kekState.containerId),
          ),
        );
      expect(head?.manifestHash).toBe(winner.request.expectedManifestHash);
      current = winner.container;
    }
  },
  concurrencyTimeoutMs,
);
