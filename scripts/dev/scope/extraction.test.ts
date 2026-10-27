import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Header } from "tar";
import { extractArchiveFile } from "./storage";

function entry(
  data: ConstructorParameters<typeof Header>[0],
  text = "",
): Buffer {
  const header = new Header({
    ...data,
    mode: 0o600,
    size: Buffer.byteLength(text),
  });
  const block = Buffer.alloc(512);
  header.encode(block);
  const body = Buffer.alloc(Math.ceil(Buffer.byteLength(text) / 512) * 512);
  body.write(text);
  return Buffer.concat([block, body]);
}

test("archive extraction rejects links and traversal before writing any files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scope-extraction-"));
  try {
    const target = join(directory, "target");
    const file = join(directory, "snapshot.tar");
    await mkdir(target);
    for (const malicious of [
      entry({ path: "link", type: "SymbolicLink", linkpath: "safe.txt" }),
      entry({ path: "../escape.txt", type: "File" }, "escape"),
    ]) {
      await writeFile(
        file,
        Buffer.concat([
          entry({ path: "safe.txt", type: "File" }, "evidence"),
          malicious,
          Buffer.alloc(1024),
        ]),
      );
      await assert.rejects(
        extractArchiveFile(file, target),
        /Unsafe snapshot entries/,
      );
      assert.deepEqual(await readdir(target), []);
      assert.equal(
        await Bun.file(join(directory, "escape.txt")).exists(),
        false,
      );
    }
    await writeFile(
      file,
      Buffer.concat([
        entry({ path: "safe.txt", type: "File" }, "evidence"),
        Buffer.alloc(1024),
      ]),
    );
    await extractArchiveFile(file, target);
    assert.equal(await readFile(join(target, "safe.txt"), "utf8"), "evidence");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
