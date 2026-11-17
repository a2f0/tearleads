import { expect } from "bun:test";
import type { OrganizationReadModelDeltaResponse } from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  createContainerMutationRequest,
  createContainerMutationResponse,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const organizationId = "11111111-1111-4111-8111-111111111111";
const containerId = "22222222-2222-4222-8222-222222222222";

const readModel: OrganizationReadModelDeltaResponse = {
  version: 6,
  mode: "delta",
  organizationId,
  nextCursor: "cursor-2",
  hasMore: false,
  currentUser: { isOrgAdmin: true },
  lanes: { grants: { organizationId, grants: [] } },
};

testApiClient(
  "a share sends the held read-model cursor and returns the delta it carries",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.post(
        `${apiBaseUrl}/containers/:containerId/share`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          return HttpResponse.json({
            ...createContainerMutationResponse(),
            readModel,
          });
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const held = await client.shareContainerResult(
      containerId,
      createContainerMutationRequest(),
      { readModelCursor: "opaque+/=cursor", reportErrors: false },
    );
    const unheld = await client.shareContainerResult(
      containerId,
      createContainerMutationRequest(),
      { reportErrors: false },
    );

    expect(held.ok && held.data.readModel).toEqual(readModel);
    expect(unheld.ok).toBe(true);
    expect(calls.map((call) => call.url)).toEqual([
      `${apiBaseUrl}/containers/${containerId}/share?readModelCursor=opaque%2B%2F%3Dcursor`,
      `${apiBaseUrl}/containers/${containerId}/share`,
    ]);
  },
);

testApiClient(
  "a share response whose delta breaks the feed contract is refused",
  async () => {
    server.use(
      http.post(`${apiBaseUrl}/containers/:containerId/share`, () =>
        HttpResponse.json({
          ...createContainerMutationResponse(),
          readModel: { ...readModel, organizationId: containerId },
        }),
      ),
    );

    const result = await new ApiClient(apiBaseUrl).shareContainerResult(
      containerId,
      createContainerMutationRequest(),
      { readModelCursor: "cursor-1", reportErrors: false },
    );

    expect(result.ok).toBe(false);
  },
);
