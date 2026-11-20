import { expect } from "bun:test";
import {
  documentSyncOperation,
  getDocumentWriterProjectionOperation,
  updateOrganizationProfileOperation,
} from "@tearleads/validators/operation";
import { encodeDocumentWriterProjection } from "@tearleads/validators/response";
import { http } from "msw";
import {
  createDocumentSyncRequest,
  createDocumentSyncResponse,
  createDocumentWriterProjectionResponse,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import { ApiRequestMetrics } from "./apiRequestMetrics";

const projection = createDocumentWriterProjectionResponse();
const organizationId = "11111111-1111-4111-8111-111111111111";
for (const target of [
  {
    operation: documentSyncOperation,
    resourceId: projection.documentId,
    response: createDocumentSyncResponse(),
    request: (client: ApiClient) =>
      client.syncDocument(projection.documentId, createDocumentSyncRequest()),
  },
  {
    operation: getDocumentWriterProjectionOperation,
    resourceId: projection.documentId,
    response: encodeDocumentWriterProjection(projection),
    request: (client: ApiClient) =>
      client.getDocumentWriterProjection(projection.documentId),
  },
  {
    operation: updateOrganizationProfileOperation,
    resourceId: organizationId,
    response: { organizationId, profileDocumentId: null },
    request: (client: ApiClient) =>
      client.updateOrganizationProfile(organizationId, {
        profileDocumentId: null,
      }),
  },
]) {
  testApiClient(
    `${target.operation.id} stays active until its response body arrives`,
    async () => {
      const metrics = new ApiRequestMetrics();
      const client = new ApiClient(apiBaseUrl, {
        metrics,
        getIdentity: () => "alice",
      });
      const active = () =>
        metrics.isResourceInFlight(
          "alice",
          target.operation,
          target.resourceId,
        );
      const headers = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      client.setOnNetworkSuccess(headers.resolve);
      let activeAtDispatch = false;
      server.use(
        http.all(`${apiBaseUrl}/*`, () => {
          activeAtDispatch = active();
          return new Response(
            new ReadableStream({
              async start(controller) {
                await release.promise;
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify(target.response)),
                );
                controller.close();
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }),
      );
      const result = target.request(client);
      try {
        await headers.promise;
        expect(activeAtDispatch).toBe(true);
        expect(metrics.getSnapshot("alice").inFlight).toBe(0);
        expect(active()).toBe(true);
      } finally {
        release.resolve();
        await result;
      }
      expect(await result).not.toBeNull();
      expect(active()).toBe(false);
    },
  );
}
