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
  createDeferred,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

function projectionCiting(
  containerId: string,
  documentId: string,
): DocumentWriterProjectionResponse {
  return JSON.parse(
    JSON.stringify(createDocumentWriterProjectionResponse())
      .replaceAll("container-1", containerId)
      .replaceAll("document-1", documentId),
  );
}

function serveProjections(
  requested: string[],
  respond: (documentId: string) => Promise<void> = async () => {},
) {
  server.use(
    http.get(
      `${apiBaseUrl}/documents/:documentId/writer-projection`,
      async ({ params: { documentId: param } }) => {
        const documentId = String(param);
        requested.push(documentId);
        await respond(documentId);
        return HttpResponse.json(
          projectionCiting(`container-of-${documentId}`, documentId),
        );
      },
    ),
  );
}

// #2395: a peer's grant, rekey or re-cite used to clear every cached writer
// projection, so a document discovery had just verified was downloaded again.
testApiClient(
  "a remote manifest change evicts only the projections citing it",
  async () => {
    const requested: string[] = [];
    serveProjections(requested);
    const client = new ApiClient(apiBaseUrl);
    await client.getDocumentWriterProjection("document-a");
    await client.getDocumentWriterProjection("document-b");

    client.evictWriterProjectionsCiting(["container-of-document-a"]);

    await client.getDocumentWriterProjection("document-a");
    await client.getDocumentWriterProjection("document-b");
    expect(requested).toEqual(["document-a", "document-b", "document-a"]);
  },
);

testApiClient(
  "a projection still in flight during the change is never cached",
  async () => {
    const requested: string[] = [];
    const release = createDeferred<void>();
    serveProjections(requested, async () => {
      if (requested.length === 1) await release.promise;
    });
    const client = new ApiClient(apiBaseUrl);
    const inFlight = client.getDocumentWriterProjectionResult("document-a", {
      reportErrors: false,
    });
    while (requested.length === 0) await Bun.sleep(1);

    client.evictWriterProjectionsCiting(["unrelated-container"]);
    release.resolve();
    await inFlight;

    await client.getDocumentWriterProjection("document-a");
    expect(requested).toEqual(["document-a", "document-a"]);
  },
);

testApiClient(
  "an attachment list goes and stays with its document's projection",
  async () => {
    const requested: string[] = [];
    const listed: string[] = [];
    serveProjections(requested);
    server.use(
      http.get(
        `${apiBaseUrl}/documents/:documentId/attachments`,
        ({ params: { documentId } }) => {
          listed.push(String(documentId));
          return HttpResponse.json([]);
        },
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    for (const documentId of ["document-a", "document-b"]) {
      await client.getDocumentWriterProjection(documentId);
      await client.listDocumentAttachments(documentId);
    }

    client.evictWriterProjectionsCiting(["container-of-document-a"]);

    await client.listDocumentAttachments("document-a");
    await client.listDocumentAttachments("document-b");
    expect(listed).toEqual(["document-a", "document-b", "document-a"]);
  },
);

// A descendant's projection names its ancestors only in its manifest path, so
// a hint for the ancestor alone must still reach it.
function childProjectionUnder(
  ancestorId: string,
): ContainerWriterProjectionResponse {
  const child: ContainerWriterProjectionResponse = JSON.parse(
    JSON.stringify(createContainerWriterProjectionResponse()).replaceAll(
      "container-1",
      "child",
    ),
  );
  const ancestorBundle = {
    event: {
      body: { eventType: "container.create" },
      event: { objectId: ancestorId, objectKind: "container" },
      eventHash: "ancestor-event-hash",
    },
    manifest: {},
    manifestHash: "ancestor-manifest-hash",
    state: {},
  };
  return {
    ...child,
    containerKeks: [...child.containerKeks, ...child.containerKeks],
    path: [ancestorBundle, ...child.path],
  } as ContainerWriterProjectionResponse;
}

testApiClient(
  "a hint for an ancestor evicts a descendant that cites it only in its path",
  async () => {
    let fetches = 0;
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:containerId/writer-projection`,
        () => {
          fetches += 1;
          return HttpResponse.json(childProjectionUnder("ancestor"));
        },
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    await client.getContainerWriterProjection("child");

    client.evictWriterProjectionsCiting(["elsewhere"]);
    await client.getContainerWriterProjection("child");
    expect(fetches).toBe(1);

    client.evictWriterProjectionsCiting(["ancestor"]);
    await client.getContainerWriterProjection("child");
    expect(fetches).toBe(2);
  },
);
