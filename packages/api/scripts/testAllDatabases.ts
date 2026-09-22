type ApiTestDatabase = "memory" | "sqlite";

export {};

interface TestResult {
  readonly database: ApiTestDatabase;
  readonly durationMs: number;
  readonly exitCode: number;
}

const databases: readonly ApiTestDatabase[] = ["memory", "sqlite"];
const testArgs = process.argv.slice(2);

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(2)}s`;
}

// Both backends run at once, so every line is tagged with the backend that
// wrote it.
async function forwardLines(
  stream: ReadableStream<Uint8Array>,
  prefix: string,
  sink: NodeJS.WriteStream,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let partial = "";
  for (;;) {
    const { done, value } = await reader.read();
    partial += decoder.decode(value, { stream: !done });
    const lines = partial.split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) {
      sink.write(`${prefix}${line}\n`);
    }
    if (done) {
      break;
    }
  }
  if (partial !== "") {
    sink.write(`${prefix}${partial}\n`);
  }
}

async function runDatabaseTests(
  database: ApiTestDatabase,
): Promise<TestResult> {
  const command = ["bun", "test", "src", "--max-concurrency=4", ...testArgs];
  const startedAt = performance.now();

  console.log(`[api:test] ${database}: ${command.join(" ")}`);
  const child = Bun.spawn({
    cmd: command,
    env: {
      ...process.env,
      API_DATABASE: database,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const prefix = `[${database}] `;
  const [exitCode] = await Promise.all([
    child.exited,
    forwardLines(child.stdout, prefix, process.stdout),
    forwardLines(child.stderr, prefix, process.stderr),
  ]);
  const durationMs = performance.now() - startedAt;
  console.log(
    `[api:test] ${database}: ${exitCode === 0 ? "passed" : "failed"} in ${formatDuration(durationMs)}`,
  );

  return { database, durationMs, exitCode };
}

// Each backend is its own process with its own in-memory database, so the two
// suites share no state and run concurrently.
const results = await Promise.all(databases.map(runDatabaseTests));

console.log("\n[api:test] database timings (backends ran concurrently)");
for (const result of results) {
  console.log(
    `[api:test] ${result.database.padEnd(6)} ${formatDuration(result.durationMs)}`,
  );
}

const failed = results.find((result) => result.exitCode !== 0);
if (failed) {
  process.exitCode = failed.exitCode;
}
