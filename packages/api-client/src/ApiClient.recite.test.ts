import { expect } from "bun:test";
import type { ContainerReciteRequest } from "@tearleads/validators/request";
import { HttpResponse, http } from "msw";
import {
  createContainerMutationResponse,
  createContainerWriterProjectionResponse,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  captureHttpCall,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

testApiClient(
  "recitation sends no KEK artifacts and evicts writer projections",
  async () => {
    const response = createContainerMutationResponse();
    Reflect.deleteProperty(response, "containerKek");
    const request: ContainerReciteRequest = {
      body: { eventType: "container.recite", containerKeyEpochId: "epoch-1" },
      event: {},
      manifest: response.accessManifest.manifest,
      expectedManifestHash: response.accessManifest.manifestHash,
      previousManifest: response.accessManifest,
      previousContainerPath: [response.accessManifest],
      principalPolicies: [],
    };
    let projectionReads = 0;
    const submittedBodies: (string | null)[] = [];
    server.use(
      http.get(`${apiBaseUrl}/containers/container-1/writer-projection`, () => {
        projectionReads += 1;
        return HttpResponse.json(createContainerWriterProjectionResponse());
      }),
      http.post(
        `${apiBaseUrl}/containers/container-1/recite`,
        async ({ request: incoming }) => {
          const call = await captureHttpCall(incoming);
          submittedBodies.push(call.body);
          expect(call.contentType).toBe("application/json");
          return HttpResponse.json(response);
        },
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    expect(
      await client.getContainerWriterProjection("container-1"),
    ).not.toBeNull();
    expect(
      await client.getContainerWriterProjection("container-1"),
    ).not.toBeNull();
    expect(projectionReads).toBe(1);
    expect(await client.reciteContainer("container-1", request)).toEqual(
      response,
    );
    expect(submittedBodies).toEqual([JSON.stringify(request)]);
    expect(
      await client.getContainerWriterProjection("container-1"),
    ).not.toBeNull();
    expect(projectionReads).toBe(2);
  },
);
