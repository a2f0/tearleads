import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const website = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(website, "../..");
const agentTool = resolve(repositoryRoot, "node_modules/.bin/agent-tool");

/** The PNG signature plus an IHDR chunk: staging reads only the size. */
export function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  const view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  view.setUint32(8, 13);
  bytes.set(new TextEncoder().encode("IHDR"), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

interface Staged {
  code: number;
  /** The disposable repository root; remove it when done. */
  root: string;
  log: string;
  /** The staged gallery directory, `<publicDir>/screenshot-gallery`. */
  output: string;
  publicDir: string;
}

/**
 * Runs `agent-tool screenshots build website --out` with this repository's
 * real `screenshots` configuration against fixture captures, laid out as the
 * capture names them (`<web|mobile|ipad>/<theme>/<screen>.png`, plus an
 * optional `capture.json`), in a disposable repository root.
 */
export async function stageScreenshots(
  files: Record<string, Uint8Array | string>,
): Promise<Staged> {
  const root = await mkdtemp(join(tmpdir(), "tearleads-screenshots-"));
  const { screenshots } = JSON.parse(
    await readFile(join(repositoryRoot, "agent-tool.json"), "utf8"),
  );
  await writeFile(
    join(root, "agent-tool.json"),
    JSON.stringify({ schemaVersion: 1, screenshots }),
  );
  for (const [file, bytes] of Object.entries(files)) {
    const path = join(root, ".screenshots", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  const publicDir = join(root, "public");
  const output = join(publicDir, "screenshot-gallery");
  const child = Bun.spawn(
    [
      process.execPath,
      agentTool,
      "--repo",
      root,
      "screenshots",
      "build",
      "website",
      "--out",
      output,
    ],
    { cwd: website, stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, root, log: `${stdout}\n${stderr}`, output, publicDir };
}
