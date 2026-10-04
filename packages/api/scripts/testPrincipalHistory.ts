// Opt-in full-boundary regression. Serialize backends so two complete histories
// and their cryptographic workers do not compete with the default test suite.
const requested = process.argv.slice(2);
const databases = requested.length > 0 ? requested : ["memory", "sqlite"];
for (const database of databases) {
  if (database !== "memory" && database !== "sqlite")
    throw new Error(`Unknown test database: ${database}`);
  console.info(`Full principal history regression: ${database}`);
  const child = Bun.spawn({
    cmd: ["bun", "test", "./test/slow/principalHistoryAvailability.test.ts"],
    env: { ...process.env, API_DATABASE: database },
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) process.exit(exitCode);
}

export {};
