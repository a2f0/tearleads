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
const DESTINATION_ID = "scope-destination";

/** The request each case holds: the signed POST or a projection read before it. */
type HeldRequest =
  | { readonly kind: "POST" }
  | { readonly kind: "projection read"; readonly containerId: string };

const HELD_REQUESTS: Record<
  (typeof ROTATIONS)[number],
  readonly HeldRequest[]
> = {
  move: [
    { kind: "POST" },
    { kind: "projection read", containerId: CHILD_ID },
    { kind: "projection read", containerId: DESTINATION_ID },
  ],
  rekey: [{ kind: "POST" }, { kind: "projection read", containerId: CHILD_ID }],
  revoke: [
    { kind: "POST" },
    { kind: "projection read", containerId: CHILD_ID },
  ],
};

function heldPath(
  rotation: (typeof ROTATIONS)[number],
  held: HeldRequest,
): string {
  return held.kind === "POST"
    ? `/containers/${CHILD_ID}/${rotation}`
    : `/containers/${held.containerId}/writer-projection`;
}

/**
 * Runs one signed rotation against a server that holds one of its requests,
 * retires the caller meanwhile, then answers it with a refresh-required 401.
 */
async function retiredRotation(
  rotation: (typeof ROTATIONS)[number],
  held: HeldRequest,
  change: (typeof SCOPE_RETIREMENTS)[number],
) {
  const scenario = await relocatedChildHistory({
    shareWithGrantee: rotation === "revoke",
  });
  const destination = await createChildContainerProjection({
    containerId: DESTINATION_ID,
    parent: scenario.parent,
    parentProjection: scenario.parent.projection,
  });
  const projections = new Map<string, ContainerWriterProjectionResponse>([
    [CHILD_ID, scenario.projection],
    [destination.projection.containerId, destination.projection],
  ]);
  const server = createExpiringApiServer({
    method: held.kind === "POST" ? "POST" : "GET",
    path: new RegExp(`^${heldPath(rotation, held)}$`),
  });
  let current = true;
  try {
    const containers = createContainerMutationServiceFixture({
      api: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async (containerId, options) =>
          held.kind === "projection read" && containerId === held.containerId
            ? server.api.getContainerWriterProjection(containerId, options)
            : (projections.get(containerId) ?? null),
        // Both adapters, so the production `*Result` submit path is the one run.
        moveContainer: server.api.moveContainer,
        moveContainerResult: server.api.moveContainerResult,
        rekeyContainer: server.api.rekeyContainer,
        rekeyContainerResult: server.api.rekeyContainerResult,
        revokeContainer: server.api.revokeContainer,
        revokeContainerResult: server.api.revokeContainerResult,
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
            destinationParentContainerId: DESTINATION_ID,
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
  for (const held of HELD_REQUESTS[rotation]) {
    const label =
      held.kind === "POST" ? "POST" : `${held.containerId} projection read`;
    test.each(SCOPE_RETIREMENTS)(
      `a ${rotation} ${label} that expires after %s is not renewed or replayed`,
      async (change) => {
        const { requests, renewals, result } = await retiredRotation(
          rotation,
          held,
          change,
        );
        expect(result).toBeNull();
        expect(requests).toEqual([
          `${held.kind === "POST" ? "POST" : "GET"} ${heldPath(rotation, held)}`,
        ]);
        expect(renewals).toBe(0);
      },
    );
  }
}
