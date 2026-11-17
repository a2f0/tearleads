import { expect, test } from "bun:test";
import {
  normalizeContainerKekKeyring,
  openContainerKekKeyring,
} from "@tearleads/crypto";
import { asContainerMutationFixture } from "@tearleads/test-utils";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { createMutationResponseFromRequest } from "../../../../../test/helpers/containerFixtures";
import { createContainerMutationServiceFixture } from "../../../../../test/helpers/containerMutationServiceFixture";
import { createChildContainerProjection } from "../../../../../test/helpers/projectionHierarchy";
import {
  CHILD_ID,
  GRANTEE_ID,
  type RelocatedChildHistory,
  relocatedChildHistory,
  servingForgedKeyring,
} from "../../../../../test/helpers/relocatedLineage";
import type { ContainerMutationServiceApi } from "../../containerMutationCollaborators";

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
    return createMutationResponseFromRequest(request, projection);
  };
  return {
    common: {
      author: scenario.parent.author,
      containerId: CHILD_ID,
      resolveProjectionUserKey: scenario.resolveProjectionUserKey,
    },
    containers: (api: Partial<ContainerMutationServiceApi>) =>
      createContainerMutationServiceFixture({
        api,
        encapsulationSecretKey: scenario.parent.secretKey,
        execSql: scenario.database.execSql,
        reportSecurityIncident: async () => {},
      }),
    projection,
    respond,
    scenario,
    submitted,
  };
}

test("a rekey refuses to re-seal a forged keyring over relocated history", async () => {
  const { common, containers, projection, respond, submitted } =
    await rotationScenario(servingForgedKeyring);
  await expect(
    containers({
      reciteContainer: async () => null,
      getContainerWriterProjection: async () => projection,
      rekeyContainer: async (_containerId, request) => respond(request),
    }).rekeyRemoteContainer(common),
  ).rejects.toThrow(REFUSAL);
  expect(submitted).toEqual([]);
});

test("a revoke refuses to re-seal a forged keyring over relocated history", async () => {
  const { common, containers, projection, respond, submitted } =
    await rotationScenario(servingForgedKeyring);
  await expect(
    containers({
      reciteContainer: async () => null,
      getContainerWriterProjection: async () => projection,
      revokeContainer: async (_containerId, request) => respond(request),
    }).revokeRemoteContainer({
      ...common,
      // The seal precedes the subject check, so any subject reaches it.
      revokedSubject: { subjectId: "user-absent", subjectType: "user" },
    }),
  ).rejects.toThrow(REFUSAL);
  expect(submitted).toEqual([]);
});

async function moveOverRelocatedHistory(
  setup: Awaited<ReturnType<typeof rotationScenario>>,
) {
  const { common, containers, projection, respond, scenario } = setup;
  const destination = await createChildContainerProjection({
    containerId: "lineage-destination",
    parent: scenario.parent,
    parentProjection: scenario.parent.projection,
  });
  const projections = new Map<string, ContainerWriterProjectionResponse>([
    [CHILD_ID, projection],
    [destination.projection.containerId, destination.projection],
  ]);
  return containers({
    reciteContainer: async () => null,
    getContainerWriterProjection: async (containerId) =>
      projections.get(containerId) ?? null,
    moveContainer: async (_containerId, request) => respond(request),
  }).moveRemoteContainer({
    ...common,
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
  const { common, containers, projection, respond, submitted } =
    await rotationScenario(servingHonestKeyring);
  const rekeyed = await containers({
    reciteContainer: async () => null,
    getContainerWriterProjection: async () => projection,
    rekeyContainer: async (_containerId, request) => respond(request),
  }).rekeyRemoteContainer(common);
  expect(rekeyed).not.toBeNull();
  expect(submitted).toHaveLength(1);
});

test("an honest move over relocated history still re-seals", async () => {
  const setup = await rotationScenario(servingHonestKeyring);
  expect(await moveOverRelocatedHistory(setup)).not.toBeNull();
  expect(setup.submitted).toHaveLength(1);
});

test("an honest revoke over relocated history still re-seals", async () => {
  const { common, containers, projection, respond, scenario, submitted } =
    await rotationScenario(servingHonestKeyring, { shareWithGrantee: true });
  const revoked = await containers({
    reciteContainer: async () => null,
    getContainerWriterProjection: async () => projection,
    revokeContainer: async (_containerId, request) => respond(request),
  }).revokeRemoteContainer({
    ...common,
    revokedSubject: { subjectId: GRANTEE_ID, subjectType: "user" },
  });
  const keyring = asContainerMutationFixture(revoked?.response).containerKek
    .keyring;
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
