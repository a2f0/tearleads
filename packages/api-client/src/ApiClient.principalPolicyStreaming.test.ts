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
import type { PrincipalPolicyPageCurrent } from "./principalPolicyPages";

const principalId = "11111111-1111-4111-8111-111111111111";
const path = `${apiBaseUrl}/principals/group/${principalId}/policy`;

function installPages(version = 66) {
  const bundle = createPrincipalPolicyBundleResponse();
  bundle.currentState.principalId = principalId;
  bundle.currentState.version = version;
  bundle.currentState.stateHash = "a".repeat(64);
  bundle.previousStates = Array.from({ length: version - 1 }, (_, index) => ({
    state: { ...bundle.currentState, version: index + 1 },
    projection: bundle.currentProjection,
    grants: [],
  }));
  const requests: { afterVersion: number; stateHash: string | null }[] = [];
  server.use(
    http.get(path, ({ request }) => {
      const query = new URL(request.url).searchParams;
      const afterVersion = Number(query.get("afterVersion") ?? 0);
      requests.push({ afterVersion, stateHash: query.get("stateHash") });
      return HttpResponse.json(
        principalPolicyPageResponse(bundle, afterVersion),
      );
    }),
  );
  const { previousStates: _, ...current } = bundle;
  return { current, requests };
}

testApiClient(
  "pulls a single history page before the consumer requests another",
  async () => {
    const { requests } = installPages();
    const pages = new ApiClient(apiBaseUrl).getPrincipalPolicyPages(
      "group",
      principalId,
    );
    const first = await pages.next();
    expect(first.done).toBeFalse();
    expect(first.value?.ok).toBeTrue();
    expect(requests).toHaveLength(1);
    await pages.return();
    expect(requests).toHaveLength(1);
  },
);

testApiClient(
  "resumes the exact saved head without fetching earlier pages",
  async () => {
    const { current, requests } = installPages();
    const versions: number[] = [];
    for await (const result of new ApiClient(
      apiBaseUrl,
    ).getPrincipalPolicyPages("group", principalId, {
      stateHash: current.currentState.stateHash,
      resume: { current, afterVersion: 32 },
    })) {
      expect(result.ok).toBeTrue();
      if (result.ok)
        versions.push(
          ...result.data.previousStates.map(({ state }) => state.version),
        );
    }
    expect(versions).toEqual(
      Array.from({ length: 33 }, (_, index) => index + 33),
    );
    expect(requests).toEqual(
      [32, 64].map((afterVersion) => ({
        afterVersion,
        stateHash: current.currentState.stateHash,
      })),
    );
  },
);

testApiClient("pins the requested head on the first page", async () => {
  const { current, requests } = installPages(1);
  const pages = new ApiClient(apiBaseUrl).getPrincipalPolicyPages(
    "group",
    principalId,
    { stateHash: current.currentState.stateHash },
  );
  expect((await pages.next()).value?.ok).toBeTrue();
  expect(requests).toEqual([
    { afterVersion: 0, stateHash: current.currentState.stateHash },
  ]);
  expect((await pages.next()).done).toBeTrue();
});

testApiClient(
  "consumer edits cannot replace the private head or cursor",
  async () => {
    const { current, requests } = installPages();
    const pages = new ApiClient(apiBaseUrl).getPrincipalPolicyPages(
      "group",
      principalId,
    );
    const first = await pages.next();
    if (!first.value?.ok) throw new Error("Expected first page");
    first.value.data.currentState.stateHash = "b".repeat(64);
    first.value.data.historyPage.nextAfterVersion = 99;
    expect((await pages.next()).value?.ok).toBeTrue();
    expect(requests[1]).toEqual({
      afterVersion: 32,
      stateHash: current.currentState.stateHash,
    });
    await pages.return();
  },
);

for (const change of ["identity", "cancellation"] as const) {
  testApiClient(
    `refuses completion after ${change} while the final page is being consumed`,
    async () => {
      const { requests } = installPages(1);
      const client = new ApiClient(apiBaseUrl);
      client.setAuthToken("original-session");
      const abort = new AbortController();
      const pages = client.getPrincipalPolicyPages("group", principalId, {
        signal: abort.signal,
      });
      expect((await pages.next()).value?.ok).toBeTrue();
      if (change === "identity") client.setAuthToken("another-session");
      else abort.abort();
      const next = await pages.next();
      expect(next.done).toBeFalse();
      expect(next.value).toMatchObject({ ok: false, kind: "cancelled" });
      expect((await pages.next()).done).toBeTrue();
      expect(requests).toHaveLength(1);
    },
  );
}

for (const afterVersion of [-1, 0.5, 66]) {
  testApiClient(
    `rejects saved cursor ${afterVersion} before sending a request`,
    async () => {
      const { current, requests } = installPages();
      const pages = new ApiClient(apiBaseUrl).getPrincipalPolicyPages(
        "group",
        principalId,
        { resume: { current, afterVersion } },
      );
      expect((await pages.next()).value).toMatchObject({
        ok: false,
        kind: "shape",
      });
      expect(requests).toHaveLength(0);
    },
  );
}

testApiClient(
  "rejects a substituted resumed head before exposing any history",
  async () => {
    const { current } = installPages();
    const pages = new ApiClient(apiBaseUrl).getPrincipalPolicyPages(
      "group",
      principalId,
      {
        resume: {
          current: {
            ...current,
            currentState: {
              ...current.currentState,
              stateHash: "b".repeat(64),
            },
          },
          afterVersion: 32,
        },
      },
    );
    expect((await pages.next()).value).toMatchObject({
      ok: false,
      kind: "shape",
    });
  },
);

for (const field of ["principalId", "principalType"] as const) {
  testApiClient(
    `rejects a first-page ${field} that differs from the request`,
    async () => {
      const { current } = installPages(1);
      if (field === "principalId")
        current.currentState.principalId = "another-principal";
      else current.currentState.principalType = "organization";
      server.use(
        http.get(path, () =>
          HttpResponse.json({
            ...current,
            previousStates: [],
            historyPage: { afterVersion: 0, nextAfterVersion: null },
          }),
        ),
      );
      const pages = new ApiClient(apiBaseUrl).getPrincipalPolicyPages(
        "group",
        principalId,
      );
      expect((await pages.next()).value).toMatchObject({
        ok: false,
        kind: "shape",
      });
    },
  );
}

testApiClient(
  "ignores extra fields on structurally compatible saved current artifacts",
  async () => {
    const { current } = installPages();
    const saved = {
      ...current,
      historyPage: { afterVersion: 32, nextAfterVersion: 64 },
    };
    const pages = new ApiClient(apiBaseUrl).getPrincipalPolicyPages(
      "group",
      principalId,
      {
        resume: { current: saved, afterVersion: 32 },
      },
    );
    expect((await pages.next()).value?.ok).toBeTrue();
    await pages.return();
  },
);

testApiClient(
  "malformed saved current artifacts return a structured failure",
  async () => {
    const { requests } = installPages();
    const malformed: unknown = { currentState: null };
    const pages = new ApiClient(apiBaseUrl).getPrincipalPolicyPages(
      "group",
      principalId,
      {
        resume: {
          current: malformed as PrincipalPolicyPageCurrent,
          afterVersion: 32,
        },
      },
    );
    expect((await pages.next()).value).toMatchObject({
      ok: false,
      kind: "shape",
    });
    expect(requests).toHaveLength(0);
  },
);

testApiClient(
  "refuses a saved head that differs from the explicitly requested hash",
  async () => {
    const { current, requests } = installPages();
    const pages = new ApiClient(apiBaseUrl).getPrincipalPolicyPages(
      "group",
      principalId,
      {
        stateHash: "b".repeat(64),
        resume: { current, afterVersion: 32 },
      },
    );
    expect((await pages.next()).value).toMatchObject({
      ok: false,
      kind: "shape",
    });
    expect(requests).toHaveLength(0);
  },
);
