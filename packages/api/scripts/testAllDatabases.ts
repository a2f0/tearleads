type ApiTestDatabase = "memory" | "sqlite";

export {};

interface TestResult {
  readonly database: ApiTestDatabase;
  readonly durationMs: number;
  readonly exitCode: number;
}

const allDatabases: readonly ApiTestDatabase[] = ["memory", "sqlite"];
const databaseFlag = "--database=";

// Per-test (and per-hook) budget for tests that set none, replacing Bun's
// 5 s default. Route tests do real signing and verification (registering one
// user alone takes about 0.4 s), so their time scales with free CPU: at
// normal load the slowest such test took 2.4 s (p99.9 2.1 s), and on
// throttled cores tests ran a median 3.6x and p90 5.9x slower. 2.4 s x 6
// rounds to 15 s, the budget most slow API tests already set by hand. See
// docs/developer/test-optimization.md. A later `--timeout` argument wins.
const API_TEST_TIMEOUT_MS = 15_000;

function isApiTestDatabase(name: string): name is ApiTestDatabase {
  return allDatabases.some((database) => database === name);
}

// `--database=<name>` (repeatable) narrows the run to those backends, so CI can
// give each backend its own runner; every other argument goes to `bun test`.
const args = process.argv.slice(2);
const selected = args
  .filter((arg) => arg.startsWith(databaseFlag))
  .map((arg) => arg.slice(databaseFlag.length));
const unknown = selected.filter((name) => !isApiTestDatabase(name));
if (unknown.length > 0) {
  throw new Error(`Unknown API test database: ${unknown.join(", ")}`);
}
const databases = selected.length
  ? allDatabases.filter((database) => selected.includes(database))
  : allDatabases;
const testArgs = args.filter((arg) => !arg.startsWith(databaseFlag));

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
  // Two workers per backend, each keeping one global across its files as the
  // serial run did (see docs/developer/test-optimization.md).
  const command = [
    "bun",
    "test",
    "src",
    "--max-concurrency=4",
    "--parallel=2",
    "--no-isolate",
    `--timeout=${API_TEST_TIMEOUT_MS}`,
    ...testArgs,
  ];
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

// Each backend is its own process with its own in-memory database, so the
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
