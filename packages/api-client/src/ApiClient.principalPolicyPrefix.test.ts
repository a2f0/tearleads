import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import { createPrincipalPolicyBundleResponse } from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { principalPolicyPageResponse } from "../test/helpers/principalPolicyPage";
import { ApiClient } from "./ApiClient";

const principalId = "11111111-1111-4111-8111-111111111111";
const stateHash = "a".repeat(64);

function prefixFixture() {
  const bundle = createPrincipalPolicyBundleResponse();
  bundle.currentState.principalId = principalId;
  bundle.currentState.version = 66;
  bundle.currentState.stateHash = stateHash;
  bundle.previousStates = Array.from({ length: 65 }, (_, index) => ({
    state: { ...bundle.currentState, version: index + 1 },
    projection: bundle.currentProjection,
    grants: [],
  }));
  const requests: number[] = [];
  server.use(
    http.get(
      `${apiBaseUrl}/principals/group/${principalId}/policy`,
      ({ request }) => {
        const query = new URL(request.url).searchParams;
        const afterVersion = Number(query.get("afterVersion") ?? 0);
        requests.push(afterVersion);
        expect(query.get("stateHash")).toBe(stateHash);
        return HttpResponse.json(
          principalPolicyPageResponse(bundle, afterVersion),
        );
      },
    ),
  );
  const { previousStates: _, ...current } = bundle;
  return { current, requests };
}

testApiClient(
  "starts a pinned read after a caller-owned verified prefix",
  async () => {
    const { requests } = prefixFixture();
    const versions: number[] = [];
    const options = { stateHash, afterVersion: 32 };
    for await (const result of new ApiClient(
      apiBaseUrl,
    ).getPrincipalPolicyPages("group", principalId, options)) {
      expect(result.ok).toBeTrue();
      if (result.ok)
        versions.push(
          ...result.data.previousStates.map(({ state }) => state.version),
        );
    }
    expect(versions).toEqual(
      Array.from({ length: 33 }, (_, index) => index + 33),
    );
    expect(requests).toEqual([32, 64]);
  },
);

for (const afterVersion of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
  testApiClient(
    `rejects invalid initial prefix cursor ${afterVersion}`,
    async () => {
      const { requests } = prefixFixture();
      const options = { stateHash, afterVersion };
      const pages = new ApiClient(apiBaseUrl).getPrincipalPolicyPages(
        "group",
        principalId,
        options,
      );
      expect((await pages.next()).value).toMatchObject({
        ok: false,
        kind: "shape",
      });
      expect(requests).toEqual([]);
    },
  );
}

for (const afterVersion of [66, 67]) {
  testApiClient(
    `refuses a prefix at or beyond the served head (${afterVersion})`,
    async () => {
      const { requests } = prefixFixture();
      const pages = new ApiClient(apiBaseUrl).getPrincipalPolicyPages(
        "group",
        principalId,
        { stateHash, afterVersion },
      );
      expect((await pages.next()).value).toMatchObject({
        ok: false,
        kind: "shape",
      });
      expect((await pages.next()).done).toBe(true);
      expect(requests).toEqual([afterVersion]);
    },
  );
}

testApiClient(
  "requires an exact pin for an initial prefix cursor",
  async () => {
    const { requests } = prefixFixture();
    const options = { afterVersion: 32, stateHash: undefined };
    const pages = new ApiClient(apiBaseUrl).getPrincipalPolicyPages(
      "group",
      principalId,
      options,
    );
    expect((await pages.next()).value).toMatchObject({
      ok: false,
      kind: "shape",
    });
    expect(requests).toEqual([]);
  },
);

testApiClient(
  "rejects ambiguous initial and saved cursor options",
  async () => {
    const { current, requests } = prefixFixture();
    const options = {
      afterVersion: 16,
      stateHash,
      resume: { current, afterVersion: 32 },
    };
    const pages = new ApiClient(apiBaseUrl).getPrincipalPolicyPages(
      "group",
      principalId,
      options,
    );
    expect((await pages.next()).value).toMatchObject({
      ok: false,
      kind: "shape",
    });
    expect(requests).toEqual([]);
  },
);
