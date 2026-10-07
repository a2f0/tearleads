import { expect } from "bun:test";
import type { PrincipalPolicySnapshotPageResponse } from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import { createPrincipalPolicyBundleResponse } from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { principalPolicyPageResponse } from "../test/helpers/principalPolicyPage";
import { ApiClient } from "./ApiClient";

function fixture() {
  const bundle = createPrincipalPolicyBundleResponse();
  bundle.currentState.version = 66;
  bundle.currentState.stateHash = "a".repeat(64);
  bundle.previousStates = Array.from({ length: 65 }, (_, index) => ({
    state: { ...bundle.currentState, version: index + 1 },
    projection: bundle.currentProjection,
    grants: [],
  }));
  const source = {
    head: { ...bundle.currentState },
    grant: "opaque-server-read-grant",
  };
  const cursors: number[] = [];
  const control: {
    corrupt?: (page: PrincipalPolicySnapshotPageResponse) => void;
    preparing: boolean;
  } = { preparing: false };
  server.use(
    http.get(`${apiBaseUrl}/principals/history`, ({ request }) => {
      const query = new URL(request.url).searchParams;
      expect(query.get("grant")).toBe("opaque-server-read-grant");
      const after = Number(query.get("afterVersion"));
      cursors.push(after);
      if (control.preparing) {
        control.preparing = false;
        return HttpResponse.json(
          {
            code: "principal_history_preparation_pending",
            committed: false,
            progressToken: "a".repeat(64),
          },
          { status: 202 },
        );
      }
      const full = principalPolicyPageResponse(bundle, after);
      const page: PrincipalPolicySnapshotPageResponse = {
        currentState: full.currentState,
        currentGrants: full.currentGrants,
        currentProjection: full.currentProjection,
        previousStates: full.previousStates,
        historyPage: full.historyPage,
      };
      if (after > 0) control.corrupt?.(page);
      return HttpResponse.json(page);
    }),
  );
  return { source, cursors, control, client: new ApiClient(apiBaseUrl) };
}

testApiClient(
  "public history lazily reads its pinned source across preparation and consumer mutation",
  async () => {
    const f = fixture();
    f.control.preparing = true;
    const pages = f.client.getProjectionPolicyHistoryPages(f.source);
    const first = await pages.next();
    expect(first.value).toMatchObject({
      ok: true,
      data: { historyPage: { afterVersion: 0 } },
    });
    expect(f.cursors).toEqual([0, 0]);
    // The consumer cannot change later request pins by retaining its input/page.
    f.source.grant = "changed";
    f.source.head.version = 100;
    if (first.value?.ok) first.value.data.historyPage.nextAfterVersion = null;
    const versions: number[] = [];
    for await (const result of pages) {
      expect(result.ok).toBe(true);
      if (result.ok)
        versions.push(
          ...result.data.previousStates.map(({ state }) => state.version),
        );
    }
    expect(versions).toEqual(Array.from({ length: 33 }, (_, i) => i + 33));
    expect(f.cursors).toEqual([0, 0, 32, 64]);
  },
);

const corruptions: readonly [
  string,
  (page: PrincipalPolicySnapshotPageResponse) => void,
][] = [
  [
    "head substitution",
    (page) => {
      page.currentState.stateHash = "b".repeat(64);
    },
  ],
  [
    "head growth",
    (page) => {
      page.currentState.version += 1;
    },
  ],
  [
    "key substitution",
    (page) => {
      page.currentState.keyEpoch += 1;
    },
  ],
  [
    "current projection drift",
    (page) => {
      page.currentProjection.push({ userId: "new-user", role: "admin" });
    },
  ],
  [
    "history gap",
    (page) => {
      page.previousStates.shift();
    },
  ],
  [
    "history scope",
    (page) => {
      const entry = page.previousStates[0];
      if (entry) entry.state.principalId = "other";
    },
  ],
  [
    "repeated cursor",
    (page) => {
      page.historyPage.nextAfterVersion = 32;
    },
  ],
  [
    "cursor mismatch",
    (page) => {
      page.historyPage.afterVersion = 0;
    },
  ],
  [
    "premature end",
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
for (const [label, corrupt] of corruptions)
  testApiClient(`public history rejects ${label}`, async () => {
    const f = fixture();
    f.control.corrupt = corrupt;
    const results = await Array.fromAsync(
      f.client.getProjectionPolicyHistoryPages(f.source),
    );
    expect(results).toHaveLength(2);
    expect(results[0]?.ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, kind: "shape" });
    expect(f.cursors).toEqual([0, 32]);
  });

testApiClient(
  "public history accepts a caller-authenticated prefix and rejects invalid cursors before HTTP",
  async () => {
    const f = fixture();
    const results = await Array.fromAsync(
      f.client.getProjectionPolicyHistoryPages(f.source, { afterVersion: 64 }),
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: true,
      data: { historyPage: { afterVersion: 64, nextAfterVersion: null } },
    });
    expect(f.cursors).toEqual([64]);
    for (const afterVersion of [-1, 0.5, 66, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        await Array.fromAsync(
          f.client.getProjectionPolicyHistoryPages(f.source, { afterVersion }),
        ),
      ).toMatchObject([{ ok: false, kind: "shape" }]);
    }
    expect(f.cursors).toEqual([64]);
  },
);

testApiClient(
  "public history stops when identity changes while a consumer verifies a page",
  async () => {
    const f = fixture();
    const pages = f.client.getProjectionPolicyHistoryPages(f.source);
    await pages.next();
    f.client.setAuthToken("changed-identity");
    expect((await pages.next()).value).toMatchObject({
      ok: false,
      kind: "cancelled",
      code: "principal_history_context_changed",
    });
    expect((await pages.next()).done).toBe(true);
    expect(f.cursors).toEqual([0]);
  },
);
