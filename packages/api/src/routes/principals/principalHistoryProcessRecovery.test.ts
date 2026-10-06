import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test.skipIf(Reflect.get(process.env, "API_DATABASE") !== "sqlite")(
  "isolated SQLite history recovery survives a server process restart",
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "principal-history-process-"),
    );
    try {
      const child = Bun.spawn({
        cmd: [
          process.execPath,
          "test",
          "test/slow/principalHistoryAvailability.test.ts",
        ],
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        env: {
          ...process.env,
          API_DATABASE: "sqlite",
          API_SQLITE_PATH: join(directory, "api.sqlite"),
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
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  75_000,
);
