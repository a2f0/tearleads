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

testApiClient(
  "member envelopes of a named state name that state in the query",
  async () => {
    const queries: URLSearchParams[] = [];
    serve(200, envelopes, queries);
    const result = await new ApiClient(apiBaseUrl).getPrincipalMemberEnvelopes(
      "group",
      principalId,
      stateHash,
    );
    expect(result).toEqual(envelopes);
    expect(queries.map((query) => Object.fromEntries(query))).toEqual([
      { stateHash },
    ]);
  },
);

testApiClient("an unknown state resolves null", async () => {
  serve(404, { error: "Principal state not found" });
  await expect(
    new ApiClient(apiBaseUrl).getPrincipalMemberEnvelopes(
      "group",
      principalId,
      stateHash,
    ),
  ).resolves.toBeNull();
});

testApiClient(
  "other failures and envelopes of another state reject",
  async () => {
    for (const [status, body] of [
      [403, { error: "Principal policy access denied" }],
      [500, { error: "Internal server error" }],
      [200, { ...envelopes, stateHash: "d".repeat(64) }],
      [200, { ...envelopes, principalId: crypto.randomUUID() }],
    ] as const) {
      serve(status, body);
      await expect(
        new ApiClient(apiBaseUrl).getPrincipalMemberEnvelopes(
          "group",
          principalId,
          stateHash,
        ),
      ).rejects.toThrow();
    }
  },
);
