import { expect, test } from "bun:test";

// Binding the environment changes module state and process.env for the entire
// isolate. Exercise it in a child so other API suites keep their own runtime.
async function bind(bindings: Record<string, unknown>) {
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
        import { bindWorkerEnvironment } from ${JSON.stringify(`${import.meta.dir}/environment.ts`)};
        process.env.DATABASE_URL = "postgres://inherited/wrong";
        bindWorkerEnvironment(${JSON.stringify(bindings)});
        console.log(JSON.stringify({
          url: process.env.DATABASE_URL,
          ssl: process.env.POSTGRES_SSL,
          stream: process.env.POSTGRES_COALESCE_WRITES,
          host: process.env.POSTGRES_HOST,
        }));
      `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

test("Hyperdrive overrides inherited URLs and disables client TLS", async () => {
  const connectionString = "postgres://edge:ephemeral@hyperdrive.local:5432/db";
  const run = await bind({
    HYPERDRIVE: { connectionString },
    POSTGRES_SSL: "true",
    POSTGRES_COALESCE_WRITES: "true",
  });
  expect(run.exitCode, run.stderr).toBe(0);
  expect(JSON.parse(run.stdout)).toEqual({
    url: connectionString,
    ssl: "false",
    stream: "true",
  });
});

test("deployed Workers require Hyperdrive even if direct secrets exist", async () => {
  const run = await bind({ POSTGRES_HOST: "old.pg.psdb.cloud" });
  expect(run.exitCode).not.toBe(0);
  expect(run.stderr).toContain("The deployed API Worker requires HYPERDRIVE");
});

test("local workerd keeps direct Postgres and TLS controls", async () => {
  const run = await bind({
    API_WORKER_LOCAL: "true",
    POSTGRES_HOST: "127.0.0.1",
    POSTGRES_SSL: "true",
    POSTGRES_COALESCE_WRITES: "true",
  });
  expect(run.exitCode, run.stderr).toBe(0);
  expect(JSON.parse(run.stdout)).toMatchObject({
    host: "127.0.0.1",
    ssl: "true",
    stream: "true",
  });
});
