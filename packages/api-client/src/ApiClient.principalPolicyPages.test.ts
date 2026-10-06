import { expect } from "bun:test";
import type { PrincipalPolicyPageResponse } from "@tearleads/validators/response";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
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
const path = `${apiBaseUrl}/principals/group/${principalId}/policy`;

function historyBundle() {
  const bundle = createPrincipalPolicyBundleResponse();
  bundle.currentState.principalId = principalId;
  bundle.currentState.version = 66;
  bundle.currentState.stateHash = "a".repeat(64);
  bundle.previousStates = Array.from({ length: 65 }, (_, index) => ({
    state: { ...bundle.currentState, version: index + 1 },
    projection: bundle.currentProjection,
    grants: [],
  }));
  return bundle;
}

testApiClient(
  "collects bounded history pages pinned to the first response",
  async () => {
    const bundle = historyBundle();
    const cursors: number[] = [];
    server.use(
      http.get(path, ({ request }) => {
        const query = new URL(request.url).searchParams;
        const after = Number(query.get("afterVersion") ?? 0);
        expect(query.get("stateHash")).toBe(
          after ? bundle.currentState.stateHash : null,
        );
        cursors.push(after);
        return HttpResponse.json(principalPolicyPageResponse(bundle, after));
      }),
    );
    expect(
      await new ApiClient(apiBaseUrl).getCurrentPrincipalPolicy(
        "group",
        principalId,
      ),
    ).toEqual(bundle);
    expect(cursors).toEqual([0, 32, 64]);
  },
);

const corruptions: ReadonlyArray<
  readonly [string, (page: PrincipalPolicyPageResponse) => void]
> = [
  [
    "substituted head",
    (page) => {
      page.currentState.stateHash = "b".repeat(64);
    },
  ],
  [
    "substituted current payload",
    (page) => {
      if (page.currentPayload) page.currentPayload.ciphertext = "substitute";
    },
  ],
  [
    "history gap",
    (page) => {
      page.previousStates.shift();
    },
  ],
  [
    "different history principal",
    (page) => {
      const entry = page.previousStates[0];
      if (entry) entry.state.principalId = "another-principal";
    },
  ],
  [
    "repeated cursor",
    (page) => {
      page.historyPage.nextAfterVersion = 32;
    },
  ],
  [
    "wrong echoed cursor",
    (page) => {
      page.historyPage.afterVersion = 0;
    },
  ],
  [
    "premature completion",
    (page) => {
      page.historyPage.nextAfterVersion = null;
    },
  ],
  [
    "oversized page",
    (page) => {
      const entry = page.previousStates[0];
      if (entry) page.previousStates.push(entry);
    },
  ],
];

for (const [name, corrupt] of corruptions) {
  testApiClient(`discards all collected history after ${name}`, async () => {
    const bundle = historyBundle();
    let calls = 0;
    server.use(
      http.get(path, ({ request }) => {
        calls += 1;
        const after = Number(
          new URL(request.url).searchParams.get("afterVersion") ?? 0,
        );
        const page = principalPolicyPageResponse(bundle, after);
        if (after) corrupt(page);
        return HttpResponse.json(page);
      }),
    );
    expect(
      await new ApiClient(apiBaseUrl).getCurrentPrincipalPolicy(
        "group",
        principalId,
      ),
    ).toBeNull();
    expect(calls).toBe(2);
  });
}

for (const change of ["identity", "cancellation"] as const) {
  testApiClient(
    `discards earlier pages after ${change} during a later response`,
    async () => {
      const bundle = historyBundle();
      const client = new ApiClient(apiBaseUrl);
      client.setAuthToken("original-session");
      const abort = new AbortController();
      let calls = 0;
      let errors = 0;
      client.setOnError(() => {
        errors += 1;
      });
      server.use(
        http.get(path, ({ request }) => {
          calls += 1;
          const after = Number(
            new URL(request.url).searchParams.get("afterVersion") ?? 0,
          );
          if (after) {
            if (change === "identity")
              client.setAuthToken("different-identity");
            else abort.abort();
          }
          return HttpResponse.json(principalPolicyPageResponse(bundle, after));
        }),
      );
      expect(
        await client.getCurrentPrincipalPolicy("group", principalId, {
          signal: abort.signal,
        }),
      ).toBeNull();
      expect([calls, errors]).toEqual([2, 0]);
    },
  );
}

testApiClient(
  "advancing pages may renew a session again without changing the pinned history",
  async () => {
    const bundle = historyBundle();
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("session-0");
    let renewals = 0;
    let errors = 0;
    const cursors: number[] = [];
    client.setOnError(() => {
      errors += 1;
    });
    client.setOnSessionExpired(() => {
      renewals += 1;
      client.setAuthToken(`session-${renewals}`);
      return true;
    });
    server.use(
      http.get(path, ({ request }) => {
        const after = Number(
          new URL(request.url).searchParams.get("afterVersion") ?? 0,
        );
        cursors.push(after);
        const expectedSession = after === 64 ? "session-2" : "session-1";
        if (
          request.headers.get("Authorization") !== `Bearer ${expectedSession}`
        )
          return HttpResponse.json(
            {
              code: SESSION_ERROR_CODES.refreshRequired,
              error: "Expired session",
            },
            { status: 401 },
          );
        return HttpResponse.json(principalPolicyPageResponse(bundle, after));
      }),
    );
    expect(
      await client.getCurrentPrincipalPolicy("group", principalId),
    ).toEqual(bundle);
    expect(cursors).toEqual([0, 0, 32, 64, 64]);
    expect([renewals, errors]).toEqual([2, 0]);
  },
);
