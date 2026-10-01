import { expect, test } from "bun:test";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createMutationResponseFromRequest,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createChildContainerProjection } from "../../../../test/helpers/projectionHierarchy";
import {
  CHILD_ID,
  relocatedChildHistory,
  servingForgedKeyring,
} from "../../../../test/helpers/relocatedLineage";
import { moveRemoteContainer } from "./move";
import { rekeyRemoteContainer } from "./rekeyRemote";
import { revokeRemoteContainer } from "./revoke";

// Each rotation re-seals the served keyring. Served over relocated history,
// a forged epoch-1 entry passes the KEK's own history check; only the
// verified lineage, threaded to the seal, refuses it (#2365 finding 32).
const REFUSAL = "omits an epoch its manifest history commits to";

async function forgedRotationScenario() {
  const scenario = await relocatedChildHistory();
  const projection = await servingForgedKeyring(scenario);
  const submitted: ContainerMutationRequest[] = [];
  const respond = async (request: ContainerMutationRequest) => {
    submitted.push(request);
    return createMutationResponseFromRequest(
      request,
      projection.containerKeks.at(-1),
    );
  };
  return {
    common: {
      author: scenario.parent.author,
      containerId: CHILD_ID,
      execSql: scenario.database.execSql,
      reportSecurityIncident: async () => {},
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(
        scenario.parent,
      ),
      targetSecretKey: scenario.parent.secretKey,
    },
    projection,
    respond,
    scenario,
    submitted,
  };
}

test("a rekey refuses to re-seal a forged keyring over relocated history", async () => {
  const { common, projection, respond, submitted } =
    await forgedRotationScenario();
  await expect(
    rekeyRemoteContainer({
      ...common,
      apiClient: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async () => projection,
        rekeyContainer: async (_containerId, request) => respond(request),
      },
    }),
  ).rejects.toThrow(REFUSAL);
  expect(submitted).toEqual([]);
});

test("a revoke refuses to re-seal a forged keyring over relocated history", async () => {
  const { common, projection, respond, submitted } =
    await forgedRotationScenario();
  await expect(
    revokeRemoteContainer({
      ...common,
      apiClient: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async () => projection,
        revokeContainer: async (_containerId, request) => respond(request),
      },
      // The seal precedes the subject check, so any subject reaches it.
      revokedSubject: { subjectId: "user-absent", subjectType: "user" },
    }),
  ).rejects.toThrow(REFUSAL);
  expect(submitted).toEqual([]);
});

test("a move refuses to re-seal a forged keyring over relocated history", async () => {
  const { common, projection, respond, scenario, submitted } =
    await forgedRotationScenario();
  const destination = await createChildContainerProjection({
    containerId: "lineage-destination",
    parent: scenario.parent,
    parentProjection: scenario.parent.projection,
  });
  const projections = new Map<string, ContainerWriterProjectionResponse>([
    [CHILD_ID, projection],
    [destination.projection.containerId, destination.projection],
  ]);
  await expect(
    moveRemoteContainer({
      ...common,
      apiClient: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async (containerId) =>
          projections.get(containerId) ?? null,
        moveContainer: async (_containerId, request) => respond(request),
      },
      destinationParentContainerId: destination.projection.containerId,
    }),
  ).rejects.toThrow(REFUSAL);
  expect(submitted).toEqual([]);
});
