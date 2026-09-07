import { expect, test } from "bun:test";
import { createRoot, type RootRuntime } from "./index";

function createRuntime() {
  let isRoot = true;
  let resolve: (() => void) | undefined;
  const deferred = new Promise<void>((done) => {
    resolve = done;
  });
  let calls = 0;
  const listeners = new Set<() => void>();
  const failAfterRelease = async () => {
    calls += 1;
    await deferred;
    return {
      ok: false as const,
      message: "Original request failure",
      status: 500,
      kind: "http" as const,
      method: "GET" as const,
      path: "/root/organizations",
      report: () => undefined,
      statusText: "Server Error",
    };
  };
  const runtime: RootRuntime = {
    authToken: () => "root-token",
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    workflowInput: () => ({
      auth: {
        isAuthenticated: true,
        isRoot,
        userId: "root-user",
        organizationId: "root-org",
      },
      crypto: { signingFingerprint: "f".repeat(64) },
      apiClient: {
        getRootOrganizationDataUsageResult: failAfterRelease,
        listRootDataUsageReportResult: failAfterRelease,
        getRootIdentityResult: failAfterRelease,
        listRootIdentitiesResult: failAfterRelease,
        listRootIdentityOrganizationsResult: failAfterRelease,
        getRootOrganizationResult: failAfterRelease,
        listRootOrganizationsResult: failAfterRelease,
        listRootOrganizationIdentitiesResult: failAfterRelease,
      },
    }),
  };
  return {
    root: createRoot(runtime),
    calls: () => calls,
    release: () => resolve?.(),
    demote: () => {
      isRoot = false;
      for (const listener of listeners) listener();
    },
  };
}

test("every organization lookup is locally gated and drops replies after demotion", async () => {
  for (const lookup of [
    "list",
    "detail",
    "identities",
    "usage",
    "report",
  ] as const) {
    const runtime = createRuntime();
    const request = () =>
      lookup === "list"
        ? runtime.root.listOrganizations()
        : lookup === "detail"
          ? runtime.root.loadOrganization("org")
          : lookup === "usage"
            ? runtime.root.loadOrganizationDataUsage("org")
            : lookup === "report"
              ? runtime.root.listDataUsageReport()
              : runtime.root.listOrganizationIdentities("org");
    const pending = request();
    expect(runtime.calls()).toBe(1);
    runtime.demote();
    runtime.release();
    expect(await pending).toMatchObject({
      ok: false,
      status: null,
      message: "The session changed while the request was in flight.",
    });
    expect(await request()).toMatchObject({
      ok: false,
      status: null,
      message: "The current session is not a platform operator.",
    });
    expect(runtime.calls()).toBe(1);
  }
});
