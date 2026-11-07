import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const principalId = "11111111-1111-4111-8111-111111111111";
const path = `${apiBaseUrl}/principals/group/${principalId}/policy/member-envelopes`;
const stateHash = "b".repeat(64);
const envelopes = {
  envelopes: [
    {
      userId: "22222222-2222-4222-8222-222222222222",
      memberKeyFingerprint: "c".repeat(64),
      kemCipherText: "kem",
      wrappedKey: "wrapped",
    },
  ],
  epoch: 2,
  principalId,
  principalType: "group" as const,
  stateHash,
};

function serve(
  status: number,
  body: Parameters<typeof HttpResponse.json>[0],
  queries: URLSearchParams[] = [],
) {
  server.use(
    http.get(path, ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      return HttpResponse.json(body, { status });
    }),
  );
}

function read() {
  return new ApiClient(apiBaseUrl).getPrincipalMemberEnvelopesResult(
    "group",
    principalId,
    stateHash,
  );
}

testApiClient(
  "member envelopes of a named state name that state in the query",
  async () => {
    const queries: URLSearchParams[] = [];
    serve(200, envelopes, queries);
    const result = await read();
    expect(result.ok && result.data).toEqual(envelopes);
    expect(queries.map((query) => Object.fromEntries(query))).toEqual([
      { stateHash },
    ]);
  },
);

testApiClient("an unknown state is an HTTP 404 failure", async () => {
  serve(404, { error: "Principal state not found" });
  const result = await read();
  expect(
    result.ok ? null : { kind: result.kind, status: result.status },
  ).toEqual({ kind: "http", status: 404 });
});

// A 200 naming another state is served material that fails verification, so
// it must stay distinguishable from an availability failure.
testApiClient(
  "envelopes of another state are shape failures, unlike HTTP errors",
  async () => {
    for (const [status, body, kind] of [
      [403, { error: "Principal policy access denied" }, "http"],
      [500, { error: "Internal server error" }, "http"],
      [200, { ...envelopes, stateHash: "d".repeat(64) }, "shape"],
      [200, { ...envelopes, principalId: crypto.randomUUID() }, "shape"],
    ] as const) {
      serve(status, body);
      const result = await read();
      expect(result.ok ? "ok" : result.kind).toBe(kind);
    }
  },
);
