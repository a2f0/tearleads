import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import {
  principalPolicyBundleResponseFor,
  principalPolicyPageResponse,
} from "../test/helpers/principalPolicyPage";
import { ApiClient } from "./ApiClient";

const principalId = "11111111-1111-4111-8111-111111111111";
const path = `${apiBaseUrl}/principals/organization/${principalId}/policy`;
const stateHash = "a".repeat(64);
const ifHead = { version: 1, stateHash };

function page() {
  const bundle = principalPolicyBundleResponseFor(
    "organization",
    principalId,
    stateHash,
  );
  bundle.currentState.version = 1;
  return principalPolicyPageResponse({ ...bundle, previousStates: [] });
}

function head(id = principalId) {
  return {
    principalType: "organization" as const,
    principalId: id,
    version: 1,
    stateHash,
    keyEpoch: 1,
    keyFingerprint: "fingerprint",
  };
}

function serve(
  body: Parameters<typeof HttpResponse.json>[0],
  queries: URLSearchParams[] = [],
) {
  server.use(
    http.get(path, ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      return HttpResponse.json(body);
    }),
  );
}

testApiClient(
  "a conditional discovery names the held head and accepts its bare head",
  async () => {
    const queries: URLSearchParams[] = [];
    serve({ unchanged: true, head: head() }, queries);
    const result = await new ApiClient(apiBaseUrl).getPrincipalPolicyDiscovery(
      "organization",
      principalId,
      { ifHead },
    );
    expect(result).toEqual({
      ok: true,
      data: { unchanged: true, head: head() },
    });
    expect(queries[0]?.get("ifVersion")).toBe("1");
    expect(queries[0]?.get("ifStateHash")).toBe(stateHash);
    expect(queries[0]?.has("stateHash")).toBe(false);
  },
);

testApiClient("a discovery page keeps the first-page checks", async () => {
  serve(page());
  const result = await new ApiClient(apiBaseUrl).getPrincipalPolicyDiscovery(
    "organization",
    principalId,
    { ifHead },
  );
  expect(result.ok && "currentState" in result.data).toBe(true);
});

testApiClient(
  "a page carrying a stray unchanged marker is still only a page",
  async () => {
    serve({ ...page(), unchanged: true });
    const result = await new ApiClient(apiBaseUrl).getPrincipalPolicyDiscovery(
      "organization",
      principalId,
      { ifHead },
    );
    expect(result.ok && "currentState" in result.data).toBe(true);
  },
);

testApiClient(
  "malformed or unrequested bare heads are shape failures",
  async () => {
    for (const [body, options] of [
      [{ unchanged: true }, { ifHead }],
      [{ unchanged: true, head: head() }, {}],
      [{ unchanged: true, head: head(crypto.randomUUID()) }, { ifHead }],
      [{ unchanged: true, head: head(), extra: 1 }, { ifHead }],
    ] as const) {
      serve(body);
      const result = await new ApiClient(
        apiBaseUrl,
      ).getPrincipalPolicyDiscovery("organization", principalId, options);
      expect(result.ok).toBe(false);
    }
  },
);
