import { expect, test } from "bun:test";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import {
  createPrincipalReciteFixture as createFixture,
  ROOT_CONTAINER_ID,
} from "../../../../test/helpers/workflows/principalReciteFixtures";
import { isProjectionVerificationCancelledError } from "../../../data/keyingProjectionVerification";
import { buildMaterializedContainerCreatePlan } from "../child/create";
import { childContainerWriterProjectionFromCreatePlan } from "../child/create/createProjection";
import { preparePrincipalContainerRematerializationBatch } from "./principalContainerRematerialization";

const MID_CONTAINER_ID = crypto.randomUUID();
const NESTED_CONTAINER_ID = crypto.randomUUID();

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function serveChild(
  fixture: Fixture,
  parent: ContainerWriterProjectionResponse,
  containerId: string,
  granted: boolean,
): Promise<void> {
  const previous = fixture.previousBundle.currentState;
  const materializedPlan = await buildMaterializedContainerCreatePlan({
    author: fixture.input.author,
    containerId,
    execSql: fixture.database.execSql,
    managedPrincipalGrant: granted
      ? {
          accessLevel: "admin",
          principalEncapsulationPublicKey: previous.encapsulationPublicKey,
          principalHead: {
            keyEpoch: previous.keyEpoch,
            keyFingerprint: previous.keyFingerprint,
            principalId: previous.principalId,
            principalType: "group",
            stateHash: previous.stateHash,
            version: previous.version,
          },
        }
      : undefined,
    parentProjection: parent,
    parentSecretKey: fixture.input.targetSecretKey,
    resolveProjectionUserKey: fixture.input.resolveTrustedUserIdentity,
    warmReferencedPrincipalPolicies:
      fixture.input.warmReferencedPrincipalPolicies,
  });
  fixture.serveProjection(
    childContainerWriterProjectionFromCreatePlan({
      materializedPlan,
      parentProjection: parent,
    }),
  );
}

/**
 * The group is granted on the root and a grandchild, with an ungranted level
 * between: rotating the root plans the granted grandchild as a target and
 * carries the stale level by reading its served projection.
 */
async function strandedLevelFixture(name: string) {
  const fixture = await createFixture({
    containerIds: [ROOT_CONTAINER_ID, NESTED_CONTAINER_ID],
    databaseName: `rematerialization-scope-${name}`,
    rotateKey: true,
  });
  const root =
    await fixture.input.apiClient.getContainerWriterProjection(
      ROOT_CONTAINER_ID,
    );
  if (!root) throw new Error("Expected root projection");
  await serveChild(fixture, root, MID_CONTAINER_ID, false);
  const mid =
    await fixture.input.apiClient.getContainerWriterProjection(
      MID_CONTAINER_ID,
    );
  if (!mid) throw new Error("Expected mid projection");
  await serveChild(fixture, mid, NESTED_CONTAINER_ID, true);
  return fixture;
}

const HELD_READS = {
  "carried level": { containerId: MID_CONTAINER_ID, preceding: false },
  "carried level after a preceding batch": {
    containerId: MID_CONTAINER_ID,
    preceding: true,
  },
  "granted target": { containerId: NESTED_CONTAINER_ID, preceding: false },
} as const;

for (const [held, { containerId, preceding }] of Object.entries(HELD_READS)) {
  test.each(SCOPE_RETIREMENTS)(
    `a rematerialization's ${held} read that expires after %s is not renewed or replayed`,
    async (change) => {
      const fixture = await strandedLevelFixture(`${held}-${change}`);
      const server = createExpiringApiServer({
        method: "GET",
        path: new RegExp(`^/containers/${containerId}/writer-projection$`),
      });
      const served = fixture.input.apiClient;
      let current = true;
      try {
        const prepared = preparePrincipalContainerRematerializationBatch({
          ...fixture.input,
          apiClient: {
            ...served,
            getContainerWriterProjection: (id, options) =>
              id === containerId
                ? server.api.getContainerWriterProjection(id, options)
                : served.getContainerWriterProjection(id),
            getContainerWriterProjectionResult: (id, options) =>
              id === containerId
                ? server.api.getContainerWriterProjectionResult(id, options)
                : served.getContainerWriterProjectionResult(id),
          },
          // An empty predecessor still routes reads through its rebase.
          preceding: preceding
            ? {
                knownContainerKeks: new Map(),
                policies: [],
                projections: [],
              }
            : undefined,
          stillCurrent: () => current,
        }).then(
          () => null,
          (error: unknown) => error,
        );
        await server.entered;
        current = false;
        server.retire(change);
        server.release();
        expect(isProjectionVerificationCancelledError(await prepared)).toBe(
          true,
        );
        expect(server.requests).toEqual([
          `GET /containers/${containerId}/writer-projection`,
        ]);
        expect(server.renewals.count).toBe(0);
      } finally {
        server.stop();
        fixture.database.close();
      }
    },
    15_000,
  );
}
