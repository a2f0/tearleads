import { expect, test } from "bun:test";
import {
  normalizeContainerKekKeyring,
  openContainerKekKeyring,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { createMutationResponseFromRequest } from "../../../../test/helpers/containerFixtures";
import { createChildContainerProjection } from "../../../../test/helpers/projectionHierarchy";
import {
  CHILD_ID,
  GRANTEE_ID,
  type RelocatedChildHistory,
  relocatedChildHistory,
  servingForgedKeyring,
} from "../../../../test/helpers/relocatedLineage";
import { moveRemoteContainer } from "./move";
import { rekeyRemoteContainer } from "./rekeyRemote";
import { revokeRemoteContainer } from "./revoke";

// Each rotation re-seals the served keyring. Served over relocated history,
// a forged epoch-1 entry passes the KEK's own history check; only the
// verified lineage, threaded to the seal, refuses it (#2365 finding 32).
// The seal's own prefix: the reader's refusal ends the same way.
const REFUSAL =
  "Container KEK keyring omits an epoch its manifest history commits to";

async function rotationScenario(
  serve: (
    scenario: RelocatedChildHistory,
  ) => Promise<ContainerWriterProjectionResponse>,
  options: Parameters<typeof relocatedChildHistory>[0] = {},
) {
  const scenario = await relocatedChildHistory(options);
  const projection = await serve(scenario);
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
      resolveProjectionUserKey: scenario.resolveProjectionUserKey,
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
    await rotationScenario(servingForgedKeyring);
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
    await rotationScenario(servingForgedKeyring);
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

async function moveOverRelocatedHistory(
  setup: Awaited<ReturnType<typeof rotationScenario>>,
) {
  const { common, projection, respond, scenario } = setup;
  const destination = await createChildContainerProjection({
    containerId: "lineage-destination",
    parent: scenario.parent,
    parentProjection: scenario.parent.projection,
  });
  const projections = new Map<string, ContainerWriterProjectionResponse>([
    [CHILD_ID, projection],
    [destination.projection.containerId, destination.projection],
  ]);
  return moveRemoteContainer({
    ...common,
    apiClient: {
      reciteContainer: async () => null,
      getContainerWriterProjection: async (containerId) =>
        projections.get(containerId) ?? null,
      moveContainer: async (_containerId, request) => respond(request),
    },
    destinationParentContainerId: destination.projection.containerId,
  });
}

test("a move refuses to re-seal a forged keyring over relocated history", async () => {
  const setup = await rotationScenario(servingForgedKeyring);
  await expect(moveOverRelocatedHistory(setup)).rejects.toThrow(REFUSAL);
  expect(setup.submitted).toEqual([]);
});

// No-brick: the same relocation with the honest served keyring still rotates.
const servingHonestKeyring = async (scenario: RelocatedChildHistory) =>
  scenario.projection;

test("an honest rekey over relocated history still re-seals", async () => {
  const { common, projection, respond, submitted } =
    await rotationScenario(servingHonestKeyring);
  const rekeyed = await rekeyRemoteContainer({
    ...common,
    apiClient: {
      reciteContainer: async () => null,
      getContainerWriterProjection: async () => projection,
      rekeyContainer: async (_containerId, request) => respond(request),
    },
  });
  expect(rekeyed).not.toBeNull();
  expect(submitted).toHaveLength(1);
});

test("an honest move over relocated history still re-seals", async () => {
  const setup = await rotationScenario(servingHonestKeyring);
  expect(await moveOverRelocatedHistory(setup)).not.toBeNull();
  expect(setup.submitted).toHaveLength(1);
});

test("an honest revoke over relocated history still re-seals", async () => {
  const { common, projection, respond, scenario, submitted } =
    await rotationScenario(servingHonestKeyring, { shareWithGrantee: true });
  const revoked = await revokeRemoteContainer({
    ...common,
    apiClient: {
      reciteContainer: async () => null,
      getContainerWriterProjection: async () => projection,
      revokeContainer: async (_containerId, request) => respond(request),
    },
    revokedSubject: { subjectId: GRANTEE_ID, subjectType: "user" },
  });
  const keyring = revoked?.response.containerKek.keyring;
  if (!revoked || !keyring) throw new Error("Expected a sealed revoke");
  expect(submitted).toHaveLength(1);
  const entries = await openContainerKekKeyring({
    keyEpoch: 3,
    keyring: normalizeContainerKekKeyring(keyring),
    successorContainerKey: revoked.containerKey,
  });
  expect(entries.map((entry) => entry.containerKeyEpochId)).toEqual([
    scenario.epoch1Id,
    scenario.epoch2Kek.containerKeyEpochId,
  ]);
});
