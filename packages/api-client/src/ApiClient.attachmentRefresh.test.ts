import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import { createBlobAttachmentBindResponse } from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

testApiClient(
  "attachment recovery refresh observes remote changes and cannot hide an outage behind cached bindings",
  async () => {
    const binding = createBlobAttachmentBindResponse();
    let bindings: (typeof binding)[] = [];
    let unavailable = false;
    let requests = 0;
    server.use(
      http.get(`${apiBaseUrl}/documents/:documentId/attachments`, () => {
        requests += 1;
        return unavailable
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json(bindings);
      }),
    );
    const client = new ApiClient(apiBaseUrl);
    expect(await client.listDocumentAttachments("document-1")).toEqual([]);

    bindings = [binding];
    expect(await client.listDocumentAttachments("document-1")).toEqual([]);
    expect(requests).toBe(1);
    expect(
      await client.listDocumentAttachments("document-1", { refresh: true }),
    ).toEqual([binding]);

    unavailable = true;
    expect(
      await client.listDocumentAttachments("document-1", { refresh: true }),
    ).toBeNull();
    unavailable = false;
    bindings = [];
    expect(await client.listDocumentAttachments("document-1")).toEqual([]);
    expect(requests).toBe(4);
  },
);
