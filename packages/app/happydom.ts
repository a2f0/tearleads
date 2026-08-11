import { afterAll } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { takeUnhandledRequests } from "./test/helpers/unhandledRequests";

// The app suite boots the real API runtime in-process (see mswServer.ts), which
// otherwise opens a live node-redis connection to :6379. Mirror
// packages/api/test/preload.ts and route those calls through the in-memory Redis
// adapter (kv + sets + pub/sub) so the suite needs no Redis server — CI provisions
// none. `??=` leaves an explicit `API_REDIS=…` override in place.
const appTestEnvironment = process.env as typeof process.env & {
  API_REDIS?: string;
};
appTestEnvironment.API_REDIS ??= "memory";

// Workspace deps the app suite imports through their *built* `dist` (their
// package exports resolve to dist, never source). Relative to this preload.
const BUILT_WORKSPACE_DEPS = [
  { name: "@tearleads/client-sdk", dir: "../client-sdk/" },
] as const;

function newestMtimeMs(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, {
    encoding: "utf8",
    recursive: true,
  })) {
    const stats = statSync(join(dir, entry));
    // Only files: a directory's mtime bumps on unrelated metadata churn.
    if (stats.isFile() && stats.mtimeMs > newest) {
      newest = stats.mtimeMs;
    }
  }
  return newest;
}

function staleDepMessage(name: string, reason: string): string {
  return [
    `${name} dist is stale (${reason}).`,
    "The app test suite binds to the built dist, so tests would otherwise fail",
    'mid-run with a confusing "Export named ... not found" error.',
    "",
    "Rebuild it:",
    `  bun run --filter='${name}' build`,
    "",
    // This guard compares mtimes; turbo keys its cache on content. An mtime-only
    // bump (git checkout, rebase, stash pop) is a cache hit, so turbo reports
    // success without rewriting dist and this guard keeps firing. The command
    // above runs the package's own build script rather than going through turbo,
    // so it always rewrites dist and always clears this.
    "`turbo run test --filter=app` and `bun run build:packages` also rebuild,",
    "but cache on content hash — after an mtime-only change they report success",
    "without touching dist, and this guard keeps firing. Prefer the command above.",
  ].join("\n");
}

// Bun does not stop the run when a preload throws: it reports the error once,
// then loads the next test file — where GlobalRegistrator never ran, so all 265
// files cascade with "document is not defined" and bury this message under
// ~10k lines of noise. Exiting is the only way to fail with one readable
// message. Nothing is registered yet (see the call site below), so there is
// nothing to unwind.
function failStaleDep(name: string, reason: string): never {
  console.error(staleDepMessage(name, reason));
  process.exit(1);
}

// turbo's `test` task depends on `^build`, so the canonical paths — `turbo run
// test`, the pre-push hook, dev servers — always rebuild dist first and this is
// a ~no-op stat walk. A raw `bun test` (especially a single-file run) bypasses
// turbo and does not, so fail fast with an actionable message instead of a
// baffling missing-export error mid-suite.
function assertBuiltWorkspaceDepsFresh(): void {
  for (const dep of BUILT_WORKSPACE_DEPS) {
    const base = fileURLToPath(new URL(dep.dir, import.meta.url));

    let srcNewest: number;
    try {
      srcNewest = newestMtimeMs(join(base, "src"));
    } catch {
      // Unexpected layout — don't let the freshness guard itself break the run;
      // turbo/CI build before tests regardless.
      continue;
    }

    let distNewest: number;
    try {
      distNewest = newestMtimeMs(join(base, "dist"));
    } catch {
      failStaleDep(dep.name, "its built output is missing");
    }

    if (srcNewest > distNewest) {
      failStaleDep(dep.name, "its source is newer than its build");
    }
  }
}

assertBuiltWorkspaceDepsFresh();

GlobalRegistrator.register();

// happy-dom registers no ResizeObserver, while every production browser has
// one — so app code constructs it unguarded. A no-op observer keeps mount
// effects working; tests that exercise resize behavior install their own mock
// (which wins by assigning over this stub).
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    disconnect(): void {}
    observe(): void {}
    unobserve(): void {}
  }
  globalThis.ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
}

interface AppTestProcessState {
  hasLoadedApiRuntimeModule: boolean;
}

const appTestProcessState = globalThis as typeof globalThis & {
  __tearleadsAppTestProcessState?: AppTestProcessState;
};

appTestProcessState.__tearleadsAppTestProcessState ??= {
  hasLoadedApiRuntimeModule: false,
};
const currentAppTestProcessState =
  appTestProcessState.__tearleadsAppTestProcessState;

afterAll(async () => {
  if (!currentAppTestProcessState.hasLoadedApiRuntimeModule) {
    return;
  }

  const cleanupModuleUrl = new URL("../api/test/cleanup.ts", import.meta.url)
    .href;
  const { closeApiTestAdapters } = await import(cleanupModuleUrl);
  await closeApiTestAdapters();
});

// An unmocked request only makes MSW log and reject the fetch, which the SDK
// turns into a non-fatal RequestFailure — so the suite goes green while the app
// under test is talking to nothing. This turns that into a failure.
//
// The check is run-scoped on purpose. Background sync is async and its fetch
// straddles the test boundary nondeterministically (two identical runs of
// Pane.identity.test.tsx recorded 10 then 7), so a per-test assertion would
// blame whichever test happened to be running. Asserting once, after every file,
// reports what went unmocked without pretending to know which test caused it.
// This must live in the preload: a module-scope afterAll in mswServer.ts would
// fire at the end of only the first file that imported it.
afterAll(() => {
  const unhandled = takeUnhandledRequests();
  if (unhandled.length === 0) {
    return;
  }

  const countsByRoute = new Map<string, number>();
  for (const entry of unhandled) {
    countsByRoute.set(entry, (countsByRoute.get(entry) ?? 0) + 1);
  }
  const counted = [...countsByRoute]
    .map(([route, count]) => `  ${route} (x${count})`)
    .sort();
  throw new Error(
    [
      `MSW intercepted ${unhandled.length} request(s) with no matching handler:`,
      ...counted,
      "",
      "The app treats a failed request as non-fatal, so these do not fail a test",
      "on their own. Add a handler to packages/app/test/helpers/mswServer.ts, or",
      "call useTestApiAppHandlers() to proxy the route to the real API runtime.",
    ].join("\n"),
  );
});

const broadcastChannelPrototype = globalThis.BroadcastChannel?.prototype;

if (broadcastChannelPrototype) {
  const addEventListener = broadcastChannelPrototype.addEventListener;
  broadcastChannelPrototype.addEventListener =
    function addEventListenerForHappyDom(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: AddEventListenerOptions | boolean,
    ) {
      if (listener === null) {
        return;
      }

      try {
        return addEventListener.call(this, type, listener, options);
      } catch (error) {
        if (
          error instanceof TypeError &&
          options &&
          typeof options === "object" &&
          "signal" in options
        ) {
          return addEventListener.call(this, type, listener);
        }
        throw error;
      }
    };
}
