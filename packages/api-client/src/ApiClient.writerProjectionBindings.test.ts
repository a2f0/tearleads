import { expect } from "bun:test";
import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  createContainerWriterProjectionResponse,
  createDocumentWriterProjectionResponse,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

// Each id binding is exercised on its own: a projection relabeled everywhere
// else is accepted, and restoring any single nested id to the substituted
// container or document makes it invalid again. Removing one binding from the
// validator therefore fails exactly the case that names it.

const REQUESTED = "requested-object";

function relabeledContainerProjection(
  projection: ContainerWriterProjectionResponse,
  id: string,
): ContainerWriterProjectionResponse {
  const leaf = projection.path.at(-1);
  const leafKek = projection.containerKeks.at(-1);
  if (!leaf || !leafKek) {
    throw new Error("Expected a container projection leaf");
  }
  return {
    ...projection,
    containerId: id,
    containerKeks: [
      ...projection.containerKeks.slice(0, -1),
      {
        ...leafKek,
        containerId: id,
        keyEpoch: { ...leafKek.keyEpoch, containerId: id },
        keyring:
          leafKek.keyring === null
            ? null
            : { ...leafKek.keyring, containerId: id },
      },
    ],
    path: [
      ...projection.path.slice(0, -1),
      {
        ...leaf,
        manifest: { ...leaf.manifest, objectId: id },
        state: { ...leaf.state, containerId: id },
      },
    ],
  };
}

function relabeledDocumentProjection(
  projection: DocumentWriterProjectionResponse,
  id: string,
): DocumentWriterProjectionResponse {
  return {
    ...projection,
    contentKeyBundle: { ...projection.contentKeyBundle, documentId: id },
    documentId: id,
    documentKekTargets: { ...projection.documentKekTargets, documentId: id },
    documentManifest: {
      ...projection.documentManifest,
      manifest: { ...projection.documentManifest.manifest, objectId: id },
      state: { ...projection.documentManifest.state, documentId: id },
    },
  };
}

async function fetchContainerProjection(
  served: ContainerWriterProjectionResponse,
) {
  server.use(
    http.get(`${apiBaseUrl}/containers/:containerId/writer-projection`, () =>
      HttpResponse.json(served),
    ),
  );
  return new ApiClient(apiBaseUrl).getContainerWriterProjection(REQUESTED);
}

async function fetchDocumentProjection(
  served: DocumentWriterProjectionResponse,
) {
  server.use(
    http.get(`${apiBaseUrl}/documents/:documentId/writer-projection`, () =>
      HttpResponse.json(served),
    ),
  );
  return new ApiClient(apiBaseUrl).getDocumentWriterProjection(REQUESTED);
}

testApiClient(
  "each container projection id binding rejects on its own",
  async () => {
    const substituted = createContainerWriterProjectionResponse();
    const relabeled = relabeledContainerProjection(substituted, REQUESTED);
    const leaf = relabeled.path.at(-1);
    const leafKek = relabeled.containerKeks.at(-1);
    if (!leaf || !leafKek) {
      throw new Error("Expected a relabeled projection leaf");
    }

    expect(await fetchContainerProjection(relabeled)).toEqual(relabeled);

    const variants: Record<string, ContainerWriterProjectionResponse> = {
      "top-level containerId": {
        ...relabeled,
        containerId: substituted.containerId,
      },
      "leaf manifest objectId": {
        ...relabeled,
        path: [{ ...leaf, manifest: substituted.path[0]?.manifest ?? {} }],
      },
      "leaf state containerId": {
        ...relabeled,
        path: [{ ...leaf, state: substituted.path[0]?.state ?? {} }],
      },
      "leaf KEK containerId": {
        ...relabeled,
        containerKeks: [{ ...leafKek, containerId: substituted.containerId }],
      },
      "leaf KEK keyEpoch containerId": {
        ...relabeled,
        containerKeks: [
          {
            ...leafKek,
            keyEpoch: {
              ...leafKek.keyEpoch,
              containerId: substituted.containerId,
            },
          },
        ],
      },
    };
    for (const [binding, served] of Object.entries(variants)) {
      expect(await fetchContainerProjection(served), binding).toBeNull();
    }
  },
);

// The keyring is null at epoch 1, so its container binding needs a rotated
// projection: a structurally valid sealed keyring that names the container.
testApiClient(
  "the leaf KEK keyring must name the requested container",
  async () => {
    const relabeled = relabeledContainerProjection(
      createContainerWriterProjectionResponse(),
      REQUESTED,
    );
    const leafKek = relabeled.containerKeks.at(-1);
    if (!leafKek) {
      throw new Error("Expected a relabeled projection leaf");
    }
    const rotated = (keyringContainerId: string) => ({
      ...relabeled,
      containerKeks: [
        {
          ...leafKek,
          containerKeyEpoch: 2,
          keyring: {
            containerId: keyringContainerId,
            containerKeyEpochId: leafKek.containerKeyEpochId,
            iv: "AAAAAAAAAAAAAAAA",
            sealed: "AAAAAAAA",
            sealingSuite:
              "tearleads.container-kek-keyring.aes-256-gcm-current-kek",
            version: 1,
          },
        },
      ],
    });

    const accepted = rotated(REQUESTED);
    expect(await fetchContainerProjection(accepted)).toEqual(accepted);
    expect(
      await fetchContainerProjection(rotated("substituted-container")),
    ).toBeNull();
  },
);

testApiClient(
  "each document projection id binding rejects on its own",
  async () => {
    const substituted = createDocumentWriterProjectionResponse();
    const relabeled = relabeledDocumentProjection(substituted, REQUESTED);

    expect(await fetchDocumentProjection(relabeled)).toEqual(relabeled);

    const variants: Record<string, DocumentWriterProjectionResponse> = {
      "top-level documentId": {
        ...relabeled,
        documentId: substituted.documentId,
      },
      "manifest objectId": {
        ...relabeled,
        documentManifest: {
          ...relabeled.documentManifest,
          manifest: substituted.documentManifest.manifest,
        },
      },
      "manifest state documentId": {
        ...relabeled,
        documentManifest: {
          ...relabeled.documentManifest,
          state: substituted.documentManifest.state,
        },
      },
      "KEK targets documentId": {
        ...relabeled,
        documentKekTargets: substituted.documentKekTargets,
      },
      "content-key bundle documentId": {
        ...relabeled,
        contentKeyBundle: substituted.contentKeyBundle,
      },
      "authorizing path leaf": {
        ...relabeled,
        authorizingContainerPaths: relabeled.authorizingContainerPaths.map(
          (path) => ({ ...path, containerId: "relabeled-container" }),
        ),
      },
    };
    for (const [binding, served] of Object.entries(variants)) {
      expect(await fetchDocumentProjection(served), binding).toBeNull();
    }
  },
);
