import { fileURLToPath } from "node:url";
import { getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import type { TestUser } from "@tearleads/bob-and-alice";
import { startPrincipalHistoryHttpProbe } from "./principalHistoryHttpProbe";
import type {
  PrincipalHistoryHttpMetrics,
  PrincipalHistoryProbeMessage,
  PrincipalHistoryServerMemory,
} from "./principalHistoryProbeProcessTypes";

type ReadyMessage = Extract<PrincipalHistoryProbeMessage, { type: "ready" }>;
type StoppedMessage = Extract<
  PrincipalHistoryProbeMessage,
  { type: "stopped" }
>;
const isolatedKey = "PRINCIPAL_HISTORY_ISOLATED_SERVER";

export function requirePrincipalHistoryProbeDatabase(): void {
  if (process.env[isolatedKey] !== "1") return;
  const kind = getDefaultApiDatabaseKind();
  const sqlitePathKey = "API_SQLITE_PATH";
  const legacyPathKey = "SQLITE_PATH";
  const path = process.env[sqlitePathKey] ?? process.env[legacyPathKey];
  if (
    kind !== "postgres" &&
    !(kind === "sqlite" && path && path !== ":memory:")
  ) {
    throw new Error(
      "Isolated history probes require PostgreSQL or file-backed SQLite",
    );
  }
}

async function withinDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("History probe IPC timed out")),
          15_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function startChild(
  owner: Pick<TestUser, "fingerprint" | "userId">,
  secret: string,
) {
  const ready = Promise.withResolvers<ReadyMessage>();
  const stopped = Promise.withResolvers<StoppedMessage>();
  // A crash before the caller asks to stop still has an observed rejection.
  void stopped.promise.catch(() => {});
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      fileURLToPath(
        new URL("./principalHistoryProbeChild.ts", import.meta.url),
      ),
    ],
    env: {
      ...process.env,
      API_REDIS: "memory",
      DOCUMENT_SYNC_CURSOR_HMAC_KEY: secret,
      PRINCIPAL_HISTORY_PROBE_IDENTITY: JSON.stringify(owner),
    },
    stdout: "ignore",
    stderr: "inherit",
    ipc(message: PrincipalHistoryProbeMessage) {
      if (message.type === "ready") ready.resolve(message);
      else if (message.type === "stopped") stopped.resolve(message);
    },
    onExit(_child, code) {
      const error = new Error(`History probe exited (${code})`);
      ready.reject(error);
      stopped.reject(error);
    },
  });
  try {
    const initialized = await withinDeadline(ready.promise);
    let stopping: Promise<StoppedMessage> | undefined;
    return {
      ...initialized,
      stop(abrupt = false) {
        stopping ??= (async () => {
          try {
            child.send(abrupt ? "snapshot" : "stop");
            const result = await withinDeadline(stopped.promise);
            if (abrupt) child.kill("SIGKILL");
            const code = await withinDeadline(child.exited);
            if (!abrupt && code !== 0)
              throw new Error(`History probe exited (${code})`);
            return result;
          } finally {
            if (child.exitCode === null) child.kill("SIGKILL");
            await child.exited;
          }
        })();
        return stopping;
      },
    };
  } catch (error) {
    child.kill("SIGKILL");
    await child.exited;
    throw error;
  }
}

function addMetrics(
  total: PrincipalHistoryHttpMetrics,
  next: PrincipalHistoryHttpMetrics,
) {
  for (const key of Object.keys(
    next,
  ) as (keyof PrincipalHistoryHttpMetrics)[]) {
    if (
      key === "requests" ||
      key === "deadlineFailures" ||
      key.startsWith("total")
    ) {
      total[key] += next[key];
    } else if (key.includes("Final")) {
      total[key] = next[key];
    } else if (!key.includes("Initial")) {
      total[key] = Math.max(total[key], next[key]);
    }
  }
}

export async function startPrincipalHistoryProbe(
  owner: Pick<TestUser, "fingerprint" | "userId" | "token">,
) {
  if (process.env[isolatedKey] !== "1") {
    const server = startPrincipalHistoryHttpProbe();
    return { ...server, token: owner.token, restart: undefined };
  }
  requirePrincipalHistoryProbeDatabase();
  const secret = `history-probe-${crypto.randomUUID()}`;
  const identity = { userId: owner.userId, fingerprint: owner.fingerprint };
  let child = await startChild(identity, secret);
  let collected = false;
  const metrics = {
    requests: 0,
    totalDatabaseStatements: 0,
    maximumDatabaseStatementsPerRequest: 0,
    deadlineFailures: 0,
    maximumRequestMs: 0,
    maximumResponseBytes: 0,
    totalResponseBytes: 0,
    processInitialRssBytes: 0,
    processPeakRssBytes: 0,
    processFinalRssBytes: 0,
    processInitialHeapUsedBytes: 0,
    processPeakHeapUsedBytes: 0,
    processFinalHeapUsedBytes: 0,
    processMaximumEventLoopDelayMs: 0,
    serverOnly: true,
    serverProcesses: [] as PrincipalHistoryServerMemory[],
  };
  async function collect(abrupt = false) {
    if (collected) return;
    const result = await child.stop(abrupt);
    collected = true;
    if (metrics.serverProcesses.length === 0) {
      metrics.processInitialRssBytes = result.metrics.processInitialRssBytes;
      metrics.processInitialHeapUsedBytes =
        result.metrics.processInitialHeapUsedBytes;
    }
    addMetrics(metrics, result.metrics);
    metrics.serverProcesses.push(result.memory);
  }
  return {
    get url() {
      return new URL(child.url);
    },
    get token() {
      return child.token;
    },
    metrics,
    async restart() {
      await collect(true);
      child = await startChild(identity, secret);
      collected = false;
    },
    stop: collect,
  };
}
