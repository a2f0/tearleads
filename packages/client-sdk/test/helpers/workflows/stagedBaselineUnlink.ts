// An unlink against an API that stages rotation baselines: a document
// linked to a parent and a child container, a fake stage server, and an
// unlink route that commits a staged group or serves a scripted refusal.
import {
  type createDocument,
  exportFullHistorySnapshot,
  type HistorySegmentSizes,
} from "@tearleads/loro";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createMockRequestFailure,
} from "@tearleads/test-utils";
import type { DocumentLinkSetMutationRequest } from "@tearleads/validators/request";
import type { DocumentLinkSetMutationFailure } from "../../../src/data/documents/shared/types";
import type { ExecSql } from "../../../src/data/sqlite/sqlSchema";
import { buildMaterializedDocumentLinkSetMutationPlan } from "../../../src/workflows/documents/linkSet";
import {
  createLinkSetResponseFromRequest,
  writerProjectionEvidence,
} from "../data/documentFixtures";
import { SMALL_BASELINE_SEGMENTS } from "../data/rotationBaselineFixtures";
import {
  FakeBaselineStageServer,
  type StageCommitRefusal,
} from "./fakeBaselineStageServer";
import { createMaterializedSyncFixture } from "./materializedSyncFixture";
import { createRemoteDocumentServiceFixture } from "./remoteDocumentServiceFixture";

type HistoryDocument = Awaited<ReturnType<typeof createDocument>>;

/** A document linked to a parent container and to a child of it. */
export async function createLinkedDocumentFixture() {
  const source = await createMaterializedSyncFixture();
  const path = source.writerProjection.authorizingContainerPaths[0];
  if (!path) throw new Error("Expected parent projection");
  const parent = Object.assign(path, {
    policyEvidence: source.writerProjection.policyEvidence,
  });
  const child = await createContainerWriterProjectionFixture({
    containerId: crypto.randomUUID(),
    encapsulationPublicKey: source.publicKey,
    organizationId: source.author.organizationId,
    parentProjection: parent,
    signerKeyFingerprint: source.author.signerKeyFingerprint,
    signerPrivateKey: source.author.signerPrivateKey,
    userId: source.author.signerUserId,
  });
  const linked = await buildMaterializedDocumentLinkSetMutationPlan({
    author: source.author,
    operation: "link",
    prepareBlobRewraps: async () => [],
    targetContainerProjection: child,
    targetSecretKey: source.secretKey,
    trustedLocalProjection: true,
    writerProjection: source.writerProjection,
  });
  const response = await createLinkSetResponseFromRequest(
    source.writerProjection.documentId,
    linked.plan.request,
  );
  return {
    ...source,
    parent,
    child,
    writerProjection: {
      ...source.writerProjection,
      authorizingContainerPaths: [parent, child],
      ...writerProjectionEvidence(
        [parent, child],
        [source.writerProjection.documentManifest],
      ),
      contentKeyBundle: response.contentKeyBundle,
      documentKekTargets: response.documentKekTargets,
      documentManifest: response.accessManifest,
    },
  };
}

type ScriptedRefusal = (
  request: DocumentLinkSetMutationRequest,
  /** The request's place among those the route has seen, from one. */
  ordinal: number,
) => StageCommitRefusal | null;

export async function createStagedUnlinkHarness() {
  const fixture = await createLinkedDocumentFixture();
  const { documentId } = fixture.writerProjection;
  const server = new FakeBaselineStageServer();
  const requests: DocumentLinkSetMutationRequest[] = [];
  const failures: DocumentLinkSetMutationFailure[] = [];
  const script: { refuse: ScriptedRefusal | null } = { refuse: null };

  const api = Object.assign(
    createMockApiClient({
      getContainerWriterProjection: async () => fixture.child,
      getDocumentWriterProjection: async () => fixture.writerProjection,
      listDocumentAttachments: async () => [],
      primeDocumentWriterProjection: () => {},
      unlinkDocumentResult: async (_documentId, request) => {
        requests.push(request);
        const [final] = request.rotationBaseline ?? [];
        const refused =
          script.refuse?.(request, requests.length) ??
          (request.baselineStageId && final
            ? server.commit({
                baselineStageId: request.baselineStageId,
                contentKeyEpoch: request.contentKeyBundle.contentKeyEpoch,
                documentId,
                final,
              })
            : null);
        if (refused) return createMockRequestFailure(refused);
        return {
          data: await createLinkSetResponseFromRequest(documentId, request),
          ok: true as const,
        };
      },
    }),
    server.api,
  );

  /** Unlink the child container, rotating over `document`'s history. */
  function unlink(
    document: HistoryDocument,
    execSql: ExecSql,
    options: {
      readonly eventId?: string | undefined;
      readonly segmentSizes?: HistorySegmentSizes | undefined;
      readonly stillCurrent?: (() => boolean) | undefined;
    } = {},
  ) {
    return createRemoteDocumentServiceFixture({
      api,
      encapsulationSecretKey: fixture.secretKey,
      execSql,
    }).relinkRemoteDocument({
      author: fixture.author,
      documentId,
      eventId: options.eventId,
      onFailure: (failure) => failures.push(failure),
      operation: "unlink",
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      rotationBaselineSegmentSizes:
        "segmentSizes" in options
          ? options.segmentSizes
          : SMALL_BASELINE_SEGMENTS,
      rotationSnapshot: exportFullHistorySnapshot(document),
      stillCurrent: options.stillCurrent,
      targetContainerId: fixture.child.containerId,
    });
  }

  return { documentId, failures, fixture, requests, script, server, unlink };
}
