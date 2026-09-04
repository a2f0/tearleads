import { expect } from "bun:test";
import {
  type VerifiedContainerAccessManifest,
  verifyContainerAccessManifest,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerReciteRequest } from "@tearleads/validators/request";
import type { ContainerReciteResponse } from "@tearleads/validators/response";
import {
  heldContainerPath,
  heldContainerSnapshot,
  rememberAcknowledgedContainerHead,
} from "../../src/data/containers/shared/heldContainerHeads";
import {
  readCanonicalJson,
  readCanonicalRecord,
} from "../../src/data/keyingCanonicalJson";
import { verifyContainerWriterProjection } from "../../src/data/keyingProjectionVerification";
import {
  readAccessEvent,
  readAccessManifest,
} from "../../src/data/keyingProjectionVerification/readers";
import {
  advanceLocallyAcknowledgedAccessManifestHeadsAtomically,
  locallyAuthoredAccessManifestHead,
} from "../../src/data/persistence/locallyAcknowledgedCheckpointPersistence";
import { buildContainerRecitePlan } from "../../src/workflows/containers/child/recitePlan";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "./containerFixtures";
import { createChildContainerProjection } from "./projectionHierarchy";

export async function createContainerReciteScenario(extraChildren = 0) {
  const parent = await createParentProjection();
  const child = await createChildContainerProjection({
    containerId: "held-child",
    parent,
    parentProjection: parent.projection,
  });
  const grandchild = await createChildContainerProjection({
    containerId: "held-grandchild",
    parent,
    parentProjection: child.projection,
  });
  const { execSql, close } = await createTestExecSql(
    "held-container-recitations",
  );
  const verifiedPath = await verifyContainerWriterProjection({
    execSql,
    projection: grandchild.projection,
    resolveUserKey: createParentProjectionUserKeyResolver(parent),
  });
  const byHash = new Map(verifiedPath.map((head) => [head.manifestHash, head]));
  for (let index = 0; index < extraChildren; index += 1) {
    const extra = await createChildContainerProjection({
      containerId: `held-extra-${index}`,
      parent,
      parentProjection: parent.projection,
    });
    const path = await verifyContainerWriterProjection({
      execSql,
      projection: extra.projection,
      resolveUserKey: createParentProjectionUserKeyResolver(parent),
    });
    for (const head of path) byHash.set(head.manifestHash, head);
  }
  const currentHashById = new Map(
    [...byHash.values()].map((head) => [
      head.state.containerId,
      head.manifestHash,
    ]),
  );
  const requests: ContainerReciteRequest[] = [];
  const responses: ContainerReciteResponse[] = [];
  const reciteContainer = async (
    id: string,
    request: ContainerReciteRequest,
  ): Promise<ContainerReciteResponse> => {
    requests.push(request);
    const event = await verifySignedAccessEvent({
      body: readCanonicalJson(request.body, "Test recitation body"),
      event: readAccessEvent(request.event, "Test recitation event"),
      signerPublicKey: parent.signingPublicKey,
    });
    if (!event.ok) throw event.error;
    const path = request.previousContainerPath.map((bundle) => {
      const verified = byHash.get(bundle.manifestHash);
      if (!verified) throw new Error("Recitation cited unknown evidence");
      return verified;
    });
    const previous = path.at(-1);
    if (!previous) throw new Error("Expected previous manifest");
    if (
      previous.state.containerId !== id ||
      path.some(
        (head) =>
          currentHashById.get(head.state.containerId) !== head.manifestHash,
      )
    ) {
      throw new Error("Recitation cited a stale current path");
    }
    expect(event.value.event.dependencyManifestHashes).toEqual(
      [...new Set(path.map((head) => head.manifestHash))].sort(),
    );
    const result = await verifyContainerAccessManifest({
      event: event.value,
      expectedManifestHash: request.expectedManifestHash,
      manifest: readAccessManifest(
        request.manifest,
        "Test recitation manifest",
      ),
      previousManifest: previous,
      previousContainerPath: path,
    });
    if (!result.ok) throw result.error;
    byHash.set(result.value.manifestHash, result.value);
    currentHashById.set(
      result.value.state.containerId,
      result.value.manifestHash,
    );
    const response = reciteResponse(result.value);
    responses.push(response);
    return response;
  };
  const advanceAncestor = async (remember = true) => {
    const snapshot = heldContainerSnapshot(
      execSql,
      parent.author.organizationId,
    );
    const path = heldContainerPath(
      snapshot.heads,
      parent.projection.containerId,
    );
    if (!path) throw new Error("Expected held ancestor path");
    const plan = await buildContainerRecitePlan({
      author: parent.author,
      path,
      policies: [],
    });
    await reciteContainer(parent.projection.containerId, plan.request);
    await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
      execSql,
      heads: [locallyAuthoredAccessManifestHead(plan)],
    });
    if (remember) rememberAcknowledgedContainerHead(execSql, plan);
    requests.length = 0;
    responses.length = 0;
    return plan;
  };
  return {
    parent,
    child,
    grandchild,
    execSql,
    close,
    requests,
    responses,
    reciteContainer,
    advanceAncestor,
  };
}

function reciteResponse(
  head: VerifiedContainerAccessManifest,
): ContainerReciteResponse {
  return {
    containerId: head.state.containerId,
    organizationId: head.state.organizationId,
    parentId: head.state.parentContainerId,
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    manifestHead: { epoch: head.state.epoch, manifestHash: head.manifestHash },
    accessManifest: {
      event: {
        event: readCanonicalRecord(head.event.event, "Test event response"),
        eventHash: head.event.eventHash,
        body: head.event.body,
      },
      manifest: readCanonicalRecord(head.manifest, "Test manifest response"),
      manifestHash: head.manifestHash,
      state: readCanonicalRecord(head.state, "Test state response"),
    },
    referencedPrincipalHeads: head.manifest.referencedPrincipalHeads.map(
      (ref) => ({ ...ref }),
    ),
  };
}
