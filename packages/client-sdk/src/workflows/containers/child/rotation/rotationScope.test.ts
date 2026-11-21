import { expect, test } from "bun:test";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { createContainerMutationServiceFixture } from "../../../../../test/helpers/workflows/containerMutationServiceFixture";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../../test/helpers/workflows/expiringApiServer";
import { createChildContainerProjection } from "../../../../../test/helpers/workflows/projectionHierarchy";
import {
  CHILD_ID,
  GRANTEE_ID,
  relocatedChildHistory,
} from "../../../../../test/helpers/workflows/relocatedLineage";

const ROTATIONS = ["move", "rekey", "revoke"] as const;

/**
 * Runs one signed rotation against a server that holds its POST, retires the
 * caller meanwhile, then answers the POST with a refresh-required 401.
 */
async function retiredRotation(
  rotation: (typeof ROTATIONS)[number],
  change: (typeof SCOPE_RETIREMENTS)[number],
) {
  const scenario = await relocatedChildHistory({
    shareWithGrantee: rotation === "revoke",
  });
  const destination = await createChildContainerProjection({
    containerId: "scope-destination",
    parent: scenario.parent,
    parentProjection: scenario.parent.projection,
  });
  const projections = new Map<string, ContainerWriterProjectionResponse>([
    [CHILD_ID, scenario.projection],
    [destination.projection.containerId, destination.projection],
  ]);
  const server = createExpiringApiServer({
    method: "POST",
    path: new RegExp(`^/containers/${CHILD_ID}/${rotation}$`),
  });
  let current = true;
  try {
    const containers = createContainerMutationServiceFixture({
      api: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async (containerId) =>
          projections.get(containerId) ?? null,
        moveContainer: server.api.moveContainer,
        rekeyContainer: server.api.rekeyContainer,
        revokeContainer: server.api.revokeContainer,
      },
      encapsulationSecretKey: scenario.parent.secretKey,
      execSql: scenario.database.execSql,
    });
    const common = {
      author: scenario.parent.author,
      containerId: CHILD_ID,
      resolveProjectionUserKey: scenario.resolveProjectionUserKey,
      stillCurrent: () => current,
    };
    const rotated =
      rotation === "move"
        ? containers.moveRemoteContainer({
            ...common,
            destinationParentContainerId: destination.projection.containerId,
          })
        : rotation === "rekey"
          ? containers.rekeyRemoteContainer(common)
          : containers.revokeRemoteContainer({
              ...common,
              revokedSubject: { subjectId: GRANTEE_ID, subjectType: "user" },
            });
    await server.entered;
    current = false;
    server.retire(change);
    server.release();
    return {
      requests: server.requests,
      renewals: server.renewals.count,
      result: await rotated,
    };
  } finally {
    server.stop();
    scenario.database.close();
  }
}

for (const rotation of ROTATIONS) {
  test.each(SCOPE_RETIREMENTS)(
    `a ${rotation} POST that expires after %s is not renewed or replayed`,
    async (change) => {
      const { requests, renewals, result } = await retiredRotation(
        rotation,
        change,
      );
      expect(result).toBeNull();
      expect(requests).toEqual([`POST /containers/${CHILD_ID}/${rotation}`]);
      expect(renewals).toBe(0);
    },
  );
}
