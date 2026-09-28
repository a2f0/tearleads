import { beforeAll, expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { createAuthor } from "../../../../test/helpers/documentFixturePrimitives";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { buildContainerCreatePlan } from "./create";
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
  return { author, deep, source, kem, resolveProjectionUserKey };
}

let fixture: Awaited<ReturnType<typeof depthFixture>>;
beforeAll(async () => {
  fixture = await depthFixture();
}, 30_000);

test("create planning refuses a valid parent already at the readable limit", async () => {
  await expect(
    buildContainerCreatePlan({
      author: fixture.author,
      containerKey: crypto.getRandomValues(new Uint8Array(32)),
      parentProjection: fixture.deep,
    }),
  ).rejects.toThrow("Container path exceeds maximum depth");
});

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
    ).rejects.toThrow("Container path exceeds maximum depth");
    expect(submitted).toBe(false);
  } finally {
    database.close();
  }
}, 30_000);
