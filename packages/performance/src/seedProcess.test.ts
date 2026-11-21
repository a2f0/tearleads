import { expect, test } from "bun:test";
import { runSeedProcess } from "./seedProcess";

test("a stalled CLI exits at the phase deadline and identifies the phase", async () => {
  await expect(
    runSeedProcess(
      "verify-seed",
      [process.execPath, "-e", "setInterval(() => {}, 1000)"],
      "",
      50,
    ),
  ).rejects.toThrow("verify-seed timed out after 50 ms.");
});

test("the benchmark waits for a CLI failure after stdin is consumed", async () => {
  await expect(
    runSeedProcess(
      "seed",
      [
        process.execPath,
        "-e",
        "process.exit((await Bun.stdin.text()) === 'test input' ? 9 : 8)",
      ],
      "test input",
    ),
  ).rejects.toThrow("seed exited with code 9.");
});

test("a parent interrupt waits for the active CLI to finish revoking", async () => {
  let revoked = false;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      if (new URL(request.url).pathname === "/ready")
        queueMicrotask(() => process.emit("SIGTERM"));
      else revoked = true;
      return new Response();
    },
  });
  try {
    await expect(
      runSeedProcess(
        "seed",
        [
          process.execPath,
          "-e",
          `const endpoint = process.argv[1];
      process.once("SIGTERM", async () => { await fetch(endpoint + "revoked"); process.exit(1); });
      await fetch(endpoint + "ready"); setInterval(() => {}, 1000);`,
          server.url.href,
        ],
        "",
      ),
    ).rejects.toThrow("seed interrupted.");
    expect(revoked).toBe(true);
  } finally {
    server.stop(true);
  }
});
