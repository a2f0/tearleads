import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  createDocumentPurgeRequest,
  createDocumentPurgeResponse,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import type { RequestResultOptions } from "./types";

const pending = {
  code: "principal_history_preparation_pending",
  committed: false,
  progressToken: "a".repeat(64),
};

for (const method of ["GET", "POST"] as const) {
  testApiClient(`${method} purge completes validated preparation`, async () => {
    const response = createDocumentPurgeResponse();
    const bodies: string[] = [];
    const handle = method === "GET" ? http.get : http.post;
    server.use(
      handle(
        `${apiBaseUrl}/documents/document-1/purge`,
        async ({ request }) => {
          bodies.push(await request.text());
          return HttpResponse.json(bodies.length === 1 ? pending : response, {
            status: bodies.length === 1 ? 202 : 200,
          });
        },
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("owner");
    const input = createDocumentPurgeRequest();
    const result =
      method === "GET"
        ? await client.getDocumentPurgeProof("document-1")
        : await client.purgeDocument("document-1", input);
    expect(result).toEqual(response);
    expect(bodies).toEqual(
      method === "GET"
        ? ["", ""]
        : [JSON.stringify(input), JSON.stringify(input)],
    );
  });

  for (const failure of [
    "network",
    "malformed",
    "busy",
    "uncertain503",
    "abort",
    "identity",
  ] as const) {
    testApiClient(
      `${method} purge classifies ${failure} without replay`,
      async () => {
        const client = new ApiClient(apiBaseUrl);
        client.setAuthToken("owner");
        const controller = new AbortController();
        const handle = method === "GET" ? http.get : http.post;
        let calls = 0;
        server.use(
          handle(`${apiBaseUrl}/documents/document-1/purge`, () => {
            calls++;
            if (failure === "network") return HttpResponse.error();
            if (failure === "busy" || failure === "uncertain503")
              return HttpResponse.json(
                {
                  error: "Busy",
                  code: "principal_history_preparation_unavailable",
                  ...(failure === "busy" ? { committed: false } : {}),
                },
                { status: 503 },
              );
            if (failure === "abort") controller.abort();
            if (failure === "identity") client.setAuthToken("replacement");
            return HttpResponse.json(
              { ...pending, committed: failure === "malformed" },
              { status: 202 },
            );
          }),
        );
        const options: RequestResultOptions = {
          signal: controller.signal,
          reportErrors: false,
        };
        const result =
          method === "GET"
            ? await client.getDocumentPurgeProof(
                "document-1",
                undefined,
                options,
              )
            : await client.purgeDocument(
                "document-1",
                createDocumentPurgeRequest(),
                options,
              );
        expect(result).toBeNull();
        expect(calls).toBe(1);
        const recorded = client.getRequestFailure({
          method,
          path: "/documents/document-1/purge",
        });
        const readKind = (
          {
            network: "network",
            malformed: "shape",
            busy: "http",
            uncertain503: "http",
            abort: "cancelled",
            identity: "cancelled",
          } as const
        )[failure];
        expect(recorded?.kind).toBe(
          method === "GET"
            ? readKind
            : failure === "busy"
              ? "http"
              : "outcome-unknown",
        );
        if (failure === "busy")
          expect(recorded?.code).toBe(
            "principal_history_preparation_unavailable",
          );
      },
    );
  }
}
