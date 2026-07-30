import { expect, test } from "bun:test";
import { resolve } from "node:path";

const nativeReleaseScript = resolve(
  import.meta.dir,
  "../../../scripts/nativeRelease.sh",
);

test("the shared native release runner rejects an invalid target", async () => {
  const child = Bun.spawn(
    [
      "sh",
      "-c",
      '. "$1"; native_release_main desktop build staging',
      "sh",
      nativeReleaseScript,
    ],
    { stderr: "pipe" },
  );
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain(
    "invalid native release target desktop:build:staging",
  );
});
