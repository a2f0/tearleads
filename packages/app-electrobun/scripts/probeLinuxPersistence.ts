const devtoolsUrl = "http://127.0.0.1:9222/json";
const startupTimeoutMs = 45_000;

export {};

interface DevToolsTarget {
  readonly type: string;
  readonly webSocketDebuggerUrl?: string;
}

interface StorageSnapshot {
  readonly body: string;
  readonly databaseName: string | null;
  readonly registry: string | null;
  readonly rootChildren: number;
  readonly userAgent: string;
}

interface PersistentState {
  readonly databaseName: string;
  readonly registry: string;
}

const storageSnapshotExpression = [
  "(async () => {",
  "  const body = document.body.innerText;",
  "  const registryKey = Object.keys(localStorage).find((key) =>",
  "    key.startsWith('tearleads.local-identity-registry:')",
  "  );",
  "  const databaseMatch = body.match(",
  "    /Initializing database: (\\S+) \\(persistent OPFS\\)/",
  "  );",
  "  return {",
  "    body,",
  "    databaseName: databaseMatch?.[1] ?? null,",
  "    registry: registryKey ? localStorage.getItem(registryKey) : null,",
  "    rootChildren: document.getElementById('root')?.children.length ?? 0,",
  "    userAgent: navigator.userAgent,",
  "  };",
  "})()",
].join("\n");

function delay(milliseconds: number): Promise<void> {
  return Bun.sleep(milliseconds);
}

async function evaluate<T>(
  webSocketDebuggerUrl: string,
  expression: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out waiting for a DevTools evaluation."));
    }, 10_000);

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { awaitPromise: true, expression, returnByValue: true },
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;

      clearTimeout(timer);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        reject(
          new Error(
            JSON.stringify(message.error ?? message.result.exceptionDetails),
          ),
        );
        return;
      }
      resolve(message.result.result.value as T);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Could not connect to the CEF DevTools endpoint."));
    });
  });
}

async function readTargets(): Promise<readonly DevToolsTarget[]> {
  const response = await fetch(devtoolsUrl);
  if (!response.ok) {
    throw new Error(`CEF DevTools returned HTTP ${String(response.status)}.`);
  }
  return (await response.json()) as readonly DevToolsTarget[];
}

async function readReadySnapshot(reopen: boolean): Promise<StorageSnapshot> {
  const deadline = Date.now() + startupTimeoutMs;
  let lastSnapshot: StorageSnapshot | null = null;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const targets = await readTargets();
      const page = targets.find(
        (target) =>
          target.type === "page" && target.webSocketDebuggerUrl !== undefined,
      );
      if (!page?.webSocketDebuggerUrl) {
        await delay(200);
        continue;
      }

      await evaluate<undefined>(
        page.webSocketDebuggerUrl,
        "document.querySelector('[aria-label=\"System Monitor\"]')?.click()",
      );
      lastSnapshot = await evaluate<StorageSnapshot>(
        page.webSocketDebuggerUrl,
        storageSnapshotExpression,
      );

      const initialized = lastSnapshot.body.includes(
        "Database initialized successfully:",
      );
      const identityReady = reopen
        ? lastSnapshot.body.includes("Local identity key package restored")
        : lastSnapshot.body.includes("Local identity key package persisted");
      const priorSchema = reopen
        ? /Database characteristics \(pre-schema\): [1-9]\d* table\(s\), [1-9]\d* row\(s\) total/.test(
            lastSnapshot.body,
          )
        : true;

      if (
        initialized &&
        identityReady &&
        priorSchema &&
        lastSnapshot.databaseName &&
        lastSnapshot.registry &&
        lastSnapshot.rootChildren > 0
      ) {
        return lastSnapshot;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }

  throw new Error(
    "Electrobun did not reach a ready persistent state.\n" +
      (lastSnapshot?.body ?? "No renderer snapshot was available.") +
      "\nLast error: " +
      String(lastError),
  );
}

function toPersistentState(snapshot: StorageSnapshot): PersistentState {
  if (!snapshot.databaseName || !snapshot.registry) {
    throw new Error("The ready snapshot omitted persistent identity state.");
  }
  if (!snapshot.userAgent.includes("Chrome/")) {
    throw new Error(
      `The renderer did not report a Chromium user agent: ${snapshot.userAgent}`,
    );
  }
  return {
    databaseName: snapshot.databaseName,
    registry: snapshot.registry,
  };
}

async function main(): Promise<void> {
  const mode = Bun.argv[2];
  if (mode !== "first" && mode !== "reopen") {
    throw new Error("Usage: probeLinuxPersistence.ts <first|reopen> [state]");
  }

  const current = toPersistentState(await readReadySnapshot(mode === "reopen"));
  if (mode === "first") {
    console.log(JSON.stringify(current));
    return;
  }

  const statePath = Bun.argv[3];
  if (!statePath) {
    throw new Error("The reopen probe requires the first-launch state path.");
  }
  const first = (await Bun.file(statePath).json()) as PersistentState;
  if (current.registry !== first.registry) {
    throw new Error("The encrypted local identity registry changed.");
  }
  if (current.databaseName !== first.databaseName) {
    throw new Error("Electrobun reopened a different identity database.");
  }
  console.log(
    `Electrobun reopened ${current.databaseName} from Linux CEF OPFS.`,
  );
}

await main();
