import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loroWasmPlugin } from "./bunPlugin";

test("a standalone executable can round-trip a Loro document", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tearleads-loro-executable-"));
  try {
    const entrypoint = join(directory, "entry.ts");
    const outfile = join(directory, "loro-test");
    const loroEntry = fileURLToPath(new URL("./index.ts", import.meta.url));
    await Bun.write(
      entrypoint,
      `
      import {
        createDocument, exportFullHistorySnapshot, importSnapshot,
      } from ${JSON.stringify(loroEntry)};
      const source = await createDocument("compiled-source");
      source.getText("body").insert(0, "standalone Loro works");
      const target = await createDocument("compiled-target");
      importSnapshot(target, exportFullHistorySnapshot(source));
      console.log(target.getText("body").toString());
      source.free();
      target.free();
    `,
    );
    const build = await Bun.build({
      entrypoints: [entrypoint],
      target: "bun",
      compile: { outfile },
      plugins: [loroWasmPlugin],
    });
    expect(build.success).toBe(true);
    const child = Bun.spawn([outfile], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("standalone Loro works");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
