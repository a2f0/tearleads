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

async function runDatabaseTests(
  database: ApiTestDatabase,
): Promise<TestResult> {
  const command = ["bun", "test", "src", "--max-concurrency=4", ...testArgs];
  const startedAt = performance.now();

  console.log(`\n[api:test] ${database}: ${command.join(" ")}`);
  const child = Bun.spawn({
    cmd: command,
    env: {
      ...process.env,
      API_DATABASE: database,
    },
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await child.exited;
  const durationMs = performance.now() - startedAt;
  console.log(
    `[api:test] ${database}: ${exitCode === 0 ? "passed" : "failed"} in ${formatDuration(durationMs)}`,
  );

  return { database, durationMs, exitCode };
}

const results: TestResult[] = [];
for (const database of databases) {
  results.push(await runDatabaseTests(database));
}

console.log("\n[api:test] database timings");
for (const result of results) {
  console.log(
    `[api:test] ${result.database.padEnd(6)} ${formatDuration(result.durationMs)}`,
  );
}

const failed = results.find((result) => result.exitCode !== 0);
if (failed) {
  process.exitCode = failed.exitCode;
}
