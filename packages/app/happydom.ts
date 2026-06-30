import { afterAll } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Workspace deps the app suite imports through their *built* `dist` (their
// package exports resolve to dist, never source). Relative to this preload.
const BUILT_WORKSPACE_DEPS = [
  { name: "@tearleads/client-sdk", dir: "../client-sdk/" },
] as const;

function newestMtimeMs(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { recursive: true })) {
    const mtimeMs = statSync(`${dir}/${entry}`).mtimeMs;
    if (mtimeMs > newest) {
      newest = mtimeMs;
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
    "or run the suite through turbo, which rebuilds dependencies for you:",
    "  turbo run test --filter=app",
  ].join("\n");
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
      srcNewest = newestMtimeMs(`${base}src`);
    } catch {
      // Unexpected layout — don't let the freshness guard itself break the run;
      // turbo/CI build before tests regardless.
      continue;
    }

    let distNewest: number;
    try {
      distNewest = newestMtimeMs(`${base}dist`);
    } catch {
      throw new Error(staleDepMessage(dep.name, "its built output is missing"));
    }

    if (srcNewest > distNewest) {
      throw new Error(
        staleDepMessage(dep.name, "its source is newer than its build"),
      );
    }
  }
}

assertBuiltWorkspaceDepsFresh();

GlobalRegistrator.register();

interface AppTestProcessState {
  hasLoadedApiRuntimeModule: boolean;
}

const appTestProcessState = globalThis as typeof globalThis & {
  __tearleadsAppTestProcessState?: AppTestProcessState;
};

if (!appTestProcessState.__tearleadsAppTestProcessState) {
  appTestProcessState.__tearleadsAppTestProcessState = {
    hasLoadedApiRuntimeModule: false,
  };
}

afterAll(async () => {
  if (
    !appTestProcessState.__tearleadsAppTestProcessState
      .hasLoadedApiRuntimeModule
  ) {
    return;
  }

  const cleanupModuleUrl = new URL("../api/test/cleanup.ts", import.meta.url)
    .href;
  const { closeApiTestAdapters } = await import(cleanupModuleUrl);
  await closeApiTestAdapters();
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
