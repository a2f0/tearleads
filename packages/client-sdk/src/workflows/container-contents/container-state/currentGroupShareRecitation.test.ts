import { expect, test } from "bun:test";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import { createMutationResponseFromRequest } from "../../../../test/helpers/containerFixtures";
import { createCurrentShareMetadataFixture } from "../../../../test/helpers/currentShareMetadata";
import { verifyContainerWriterProjection } from "../../../data/keyingProjectionVerification";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../../containers";
import { resolveDocumentCreateAuthor } from "../../documents";
import { shareRemoteContainerWithGroup } from "./remote";

test("Current sharing without a caller predicate still schedules held descendant recitations", async () => {
  const containerId = crypto.randomUUID();
  const f = await createCurrentShareMetadataFixture({
    grantedContainerId: containerId,
  });
  const author = resolveDocumentCreateAuthor(f.runtime);
  const keys = f.runtime.crypto.encapsulationKeyPair;
  if (!author || !keys) throw new Error("Missing fixture writer");
  const projection = await createContainerWriterProjectionFixture({
    containerId,
    organizationId: f.organizationId,
    userId: author.signerUserId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    encapsulationPublicKey: keys.publicKey,
  });
  const childId = crypto.randomUUID();
  const child = await buildMaterializedContainerCreatePlan({
    author,
    containerId: childId,
    metadataDocumentId: crypto.randomUUID(),
    parentProjection: projection,
    parentSecretKey: keys.secretKey,
    trustedLocalProjection: true,
  });
  await verifyContainerWriterProjection({
    execSql: f.options.execSql,
    projection: childContainerWriterProjectionFromCreatePlan({
      materializedPlan: child,
      parentProjection: projection,
    }),
    resolveUserKey: f.runtime.resolveTrustedUserIdentity,
  });
  const readProjection = f.options.apiClient.getContainerWriterProjection.bind(
    f.options.apiClient,
  );
  f.options.apiClient.getContainerWriterProjection = async (id) =>
    id === containerId ? projection : readProjection(id);
  f.options.apiClient.shareContainer = async (_id, request) =>
    createMutationResponseFromRequest(request);
  const started = Promise.withResolvers<string>();
  f.options.apiClient.reciteContainer = async (id) => {
    started.resolve(id);
    return null;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    expect(
      await shareRemoteContainerWithGroup({
        accessLevel: "read",
        containerId,
        previousProjection: projection,
        recipientGroupId: f.group.currentState.principalId,
        resolveProjectionUserKey: f.runtime.resolveTrustedUserIdentity,
        runtime: f.runtime,
      }),
    ).not.toBeNull();
    const observed = await Promise.race([
      started.promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 5_000);
      }),
    ]);
    expect(observed).toBe(childId);
    expect(f.fullReads()).toBe(0);
  } finally {
    clearTimeout(timer);
    f.close();
  }
}, 15_000);
