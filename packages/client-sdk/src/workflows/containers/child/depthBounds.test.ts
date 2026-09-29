import { beforeAll, expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { createAuthor } from "../../../../test/helpers/documentFixturePrimitives";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { ContainerPathTooDeepError } from "../../../data/containers/shared/containerPathLimits";
import { buildMaterializedContainerCreatePlan } from "./create";
import { moveRemoteContainer } from "./move";

async function depthFixture() {
  const { author, signingPublicKey } = await createAuthor();
  const kem = generateKemSeedAndKeyPair();
  const common = {
    encapsulationPublicKey: kem.publicKey,
    organizationId: author.organizationId,
    signerDeviceId: author.signerDeviceId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  };
  const root = await createContainerWriterProjectionFixture({
    ...common,
    containerId: "root",
  });
  let deep: ContainerWriterProjectionResponse = root;
  for (let depth = 1; depth < 100; depth += 1) {
    deep = await createContainerWriterProjectionFixture({
      ...common,
      containerId: `depth-${depth}`,
      parentProjection: deep,
    });
  }
  const source = await createContainerWriterProjectionFixture({
    ...common,
    containerId: "source",
    parentProjection: root,
  });
  const resolveProjectionUserKey = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: kem.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId: author.signerUserId,
  });
  return { author, deep, root, source, kem, resolveProjectionUserKey };
}

let fixture: Awaited<ReturnType<typeof depthFixture>>;
beforeAll(async () => {
  fixture = await depthFixture();
}, 30_000);

/** A shallow projection whose unverified path is padded past the limit. */
function padded(
  projection: ContainerWriterProjectionResponse,
): ContainerWriterProjectionResponse {
  const repeat = <T>(entries: readonly T[]) =>
    Array.from({ length: 100 }, () => entries[0] as T);
  return {
    ...projection,
    containerKeks: repeat(projection.containerKeks),
    path: repeat(projection.path),
  };
}

async function planCreate(parentProjection: ContainerWriterProjectionResponse) {
  const database = await createTestExecSql("container-depth-create");
  try {
    return await buildMaterializedContainerCreatePlan({
      author: fixture.author,
      execSql: database.execSql,
      parentProjection,
      parentSecretKey: fixture.kem.secretKey,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    });
  } finally {
    database.close();
  }
}

test("create planning refuses a verified parent already at the readable limit", async () => {
  await expect(planCreate(fixture.deep)).rejects.toBeInstanceOf(
    ContainerPathTooDeepError,
  );
}, 30_000);

test("a padded unverified parent path fails verification, not the depth check", async () => {
  const refused = await planCreate(padded(fixture.root)).catch(
    (error: unknown) => error,
  );
  expect(refused).toBeInstanceOf(KeyingVerificationError);
  expect(refused).not.toBeInstanceOf(ContainerPathTooDeepError);
}, 30_000);

test("move refuses an over-depth destination before submitting a mutation", async () => {
  const database = await createTestExecSql("container-depth-precheck");
  let submitted = false;
  try {
    await expect(
      moveRemoteContainer({
        author: fixture.author,
        containerId: fixture.source.containerId,
        destinationParentContainerId: fixture.deep.containerId,
        execSql: database.execSql,
        reportSecurityIncident: async () => {},
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        targetSecretKey: fixture.kem.secretKey,
        apiClient: {
          getContainerWriterProjection: async (id) =>
            id === fixture.source.containerId ? fixture.source : fixture.deep,
          moveContainer: async () => {
            submitted = true;
            return null;
          },
          reciteContainer: async () => null,
        },
      }),
    ).rejects.toBeInstanceOf(ContainerPathTooDeepError);
    expect(submitted).toBe(false);
  } finally {
    database.close();
  }
}, 30_000);

test("a padded unverified destination path fails verification, not the depth check", async () => {
  const database = await createTestExecSql("container-depth-padded-move");
  let submitted = false;
  try {
    const destination = padded(fixture.root);
    const refused = await moveRemoteContainer({
      author: fixture.author,
      containerId: fixture.source.containerId,
      destinationParentContainerId: destination.containerId,
      execSql: database.execSql,
      reportSecurityIncident: async () => {},
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.kem.secretKey,
      apiClient: {
        getContainerWriterProjection: async (id) =>
          id === fixture.source.containerId ? fixture.source : destination,
        moveContainer: async () => {
          submitted = true;
          return null;
        },
        reciteContainer: async () => null,
      },
    }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(KeyingVerificationError);
    expect(refused).not.toBeInstanceOf(ContainerPathTooDeepError);
    expect(submitted).toBe(false);
  } finally {
    database.close();
  }
}, 30_000);
