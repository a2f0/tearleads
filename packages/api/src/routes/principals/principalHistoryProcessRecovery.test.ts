import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// The isolated server is a second process, so the history it prepares must
// outlive it in a shared database: this runs in the Postgres lane only.
test.skipIf(Reflect.get(process.env, "API_DATABASE") !== "postgres")(
  "isolated history recovery survives a server process restart",
  async () => {
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        "test",
        "test/slow/principalHistoryAvailability.test.ts",
      ],
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env: {
        ...process.env,
        PRINCIPAL_HISTORY_ISOLATED_SERVER: "1",
        PRINCIPAL_HISTORY_THROUGH_VERSION: "64",
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
      killSignal: "SIGKILL",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const output = `${stdout}\n${stderr}`;
    expect(code, output).toBe(0);
    expect(output).toContain("server restarted after preparation");
    expect(output).toContain('"serverOnly":true');
    expect(output).toContain('"retainedHeapUsedBytes":');
    expect(output).toContain("cold recovery complete");
  },
  75_000,
);
