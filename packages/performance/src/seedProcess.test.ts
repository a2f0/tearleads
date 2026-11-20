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
