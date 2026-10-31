import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import {
  createRemoteContainer,
  createRemoteDocument,
  rekeyRemoteContainer,
  syncRemoteDocument,
} from "@tearleads/client-sdk";
import {
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  wrapContentKey,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestUser } from "@tearleads/test-utils";
import {
  DocumentWriterProjectionWireResponseSchema,
  isCitedContainerKekLevel,
} from "@tearleads/validators/response";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import { writerResolver } from "../../../test/helpers/coldSdkRematerialization";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import { createHeldManifestCitations } from "../../../test/helpers/heldManifestCitations";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { recoverRegisteredRootKek } from "../../../test/helpers/registeredRootKek";
import { withStoredContainerMutation } from "../../../test/helpers/storedContainerMutation";
import { routeApp } from "../../routeApp";

test("real document projections cite held manifests through links, rotations and cold recovery", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await recoverRegisteredRootKek({
    owner,
    root: await bootstrapRoot(owner),
  });
  const organizationId = asVerifiedContainerManifest(root.bundle).state
    .organizationId;
  const device = await createAncestorSdkContext(owner, organizationId);
  const cold = await createAncestorSdkContext(owner, organizationId);
  // Rotate from another device: the reader holds both children, so using it
  // here schedules background re-citations that can advance its checkpoints
  // during both the initial read and its one permitted projection refresh.
  const rotator = await createAncestorSdkContext(owner, organizationId);
  const recitedContainerIds: string[] = [];
  const samples: {
    hinted: boolean;
    served: number;
    omitted: number;
    documentHistory: number;
    citedLevels: number;
    levels: number;
  }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      if (/^\/containers\/[^/]+\/recite$/.test(new URL(request.url).pathname)) {
        recitedContainerIds.push(new URL(request.url).pathname);
      }
      const response = await routeApp.fetch(request);
      if (
        response.ok &&
        /^\/documents\/[^/]+\/writer-projection$/.test(
          new URL(request.url).pathname,
        )
      ) {
        const wire = DocumentWriterProjectionWireResponseSchema.parse(
          await response.clone().json(),
        );
        samples.push({
          hinted: request.headers.has("x-known-manifests"),
          served: Object.keys(wire.bundles).length,
          omitted: wire.omittedBundles.length,
          documentHistory: wire.documentManifestHistory.length,
          citedLevels: wire.authorizingContainerPaths
            .flatMap((path) => path.containerKeks)
            .filter(isCitedContainerKekLevel).length,
          levels: wire.authorizingContainerPaths.flatMap(
            (path) => path.containerKeks,
          ).length,
        });
      }
      return response;
    },
  });
  const client = new ApiClient(server.url.origin);
  client.setAuthToken(owner.token);
  const held = createHeldManifestCitations();
  client.setVerifiedManifestCitations(held.citations);
  const common = {
    ...device.common,
    apiClient: client,
    reportSecurityIncident: async () => undefined,
    resolveTrustedUserIdentity: device.resolveTrustedUserIdentity,
  };
  try {
    const created = await createRemoteDocument({
      ...common,
      containerId: root.kekState.containerId,
    });
    if (!created?.response) throw new Error("Expected encrypted document");
    const createdResponse = created.response;
    let current = createdResponse;
    const linkChild = async () => {
      const child = await createRemoteContainer({
        ...common,
        parentContainerId: root.kekState.containerId,
        parentSecretKey: owner.kem.secretKey,
      });
      if (!child) throw new Error("Expected encrypted child");
      const request = await buildDocumentLinkRequest({
        child: await withStoredContainerMutation(child.response),
        createdDocument: current,
        owner,
        root,
      });
      const target = request.contentKeyBundle.targets.find(
        (entry) => entry.containerId === child.containerId,
      );
      if (!target) throw new Error("Expected child target");
      const wrapped = await wrapContentKey(
        created.contentKey,
        child.containerKey,
        {
          kind: "Document",
          objectId: created.documentId,
          contentKeyEpoch: request.contentKeyBundle.contentKeyEpoch,
          containerId: target.containerId,
          containerKeyEpochId: target.containerKeyEpochId,
        },
      );
      const linked = await client.linkDocument(created.documentId, {
        ...request,
        contentKeyBundle: {
          ...request.contentKeyBundle,
          targets: request.contentKeyBundle.targets.map((entry) =>
            entry === target
              ? {
                  ...entry,
                  wrappedKey: bytesToBase64(wrapped.ciphertext),
                  wrappingMetadata: {
                    suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
                    iv: bytesToBase64(wrapped.iv),
                  },
                }
              : entry,
          ),
        },
      });
      if (!linked) throw new Error("Expected document link");
      current = { ...linked, createdAt: createdResponse.createdAt };
    };
    const read = async (apiClient = client, context = device) => {
      apiClient.clearWriterProjectionCaches();
      const projection = await apiClient.getDocumentWriterProjection(
        created.documentId,
      );
      if (!projection) throw new Error("Expected document projection");
      const result = await syncRemoteDocument({
        ...context.common,
        apiClient,
        documentId: created.documentId,
        writerProjection: projection,
        localVersionVector: null,
        pendingUpdates: [],
        resolveWriterPublicKey: writerResolver(owner),
        validateIncomingUpdates: () => undefined,
      });
      if (!result) throw new Error("Expected verified document read");
      expect(result.contentKey).toEqual(created.contentKey);
      if (apiClient === client) held.holdDocument(projection);
      return { projection, result };
    };
    await linkChild();
    const first = await read();
    expect(first.projection.authorizingContainerPaths).toHaveLength(2);
    expect(
      first.projection.documentManifestContainerPaths.some(
        (path) => path.length > 1,
      ),
    ).toBe(true);
    const repeated = await read();
    expect(repeated.projection.documentManifest).toEqual(
      first.projection.documentManifest,
    );
    expect(samples[0]?.hinted).toBe(false);
    expect(samples[1]?.hinted).toBe(true);
    expect(samples[1]?.omitted).toBe(samples[0]?.served);
    expect(samples[1]?.served).toBe(0);
    // Every authorizing path's KEK level is held, so each travels as a digest.
    expect(samples[1]?.citedLevels).toBe(samples[1]?.levels);
    expect(samples[1]?.levels).toBeGreaterThan(0);
    await linkChild();
    const grown = await read();
    expect(grown.projection.authorizingContainerPaths).toHaveLength(3);
    expect(grown.projection.documentManifestHistory).toHaveLength(2);
    expect(samples[2]?.documentHistory).toBe(2);
    expect(samples[2]?.omitted).toBeGreaterThan(0);
    expect(
      await rekeyRemoteContainer({
        ...rotator.common,
        apiClient: client,
        reportSecurityIncident: async () => undefined,
        containerId: root.kekState.containerId,
      }),
    ).not.toBeNull();
    const rotated = await read();
    expect(rotated.projection.contentKeyBundleStale).toBe(true);
    expect(samples[3]?.omitted).toBeGreaterThan(0);
    // The rotated root's level is new; levels below it may still be held.
    expect(samples[3]?.citedLevels).toBeLessThan(samples[3]?.levels ?? 0);
    const fresh = new ApiClient(server.url.origin);
    fresh.setAuthToken(owner.token);
    const recovered = await read(fresh, cold);
    expect(samples).toHaveLength(5);
    expect(recitedContainerIds).toEqual([]);
    expect(samples.at(-1)?.hinted).toBe(false);
    expect(samples.at(-1)?.omitted).toBe(0);
    expect(samples.at(-1)?.citedLevels).toBe(0);
    expect(samples.at(-1)?.served).toBeGreaterThan(samples[3]?.served ?? 0);
    expect(recovered.projection.documentManifest).toEqual(
      rotated.projection.documentManifest,
    );
    expect(recovered.projection.policyEvidence).toEqual(
      rotated.projection.policyEvidence,
    );
  } finally {
    server.stop(true);
    rotator.close();
    cold.close();
    device.close();
  }
}, 120_000);
