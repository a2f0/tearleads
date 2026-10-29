import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  codeReferenceIssues,
  isCodeReferenceDocument,
  linkCodeReferences,
} from "../docCodeReferences";
import {
  checkDocuments,
  documentsToCheck,
  listRepositoryFiles,
  repositoryFiles,
} from "../docLinks";
import { probeExternalLinks } from "../externalLinks";
import { headingAnchors, markdownTargets, slugify } from "../markdownScan";

const linter = resolve(import.meta.dir, "../lintDocLinks.ts");
const repoRoot = resolve(import.meta.dir, "../../..");

function fixture(files: Record<string, string>) {
  const cwd = mkdtempSync(join(tmpdir(), "tearleads-doc-links-"));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), source);
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd });
  const lint = (...args: string[]) => {
    const result = Bun.spawnSync([process.execPath, linter, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: result.exitCode,
      output: result.stdout.toString() + result.stderr.toString(),
    };
  };
  return { cwd, lint };
}

test("the repository's documentation links are valid", () => {
  const repo = repositoryFiles(repoRoot, listRepositoryFiles(repoRoot));
  const documents = documentsToCheck(repo);
  const { issues } = checkDocuments(repo, documents);
  for (const document of documents.filter(isCodeReferenceDocument)) {
    const source = readFileSync(join(repoRoot, document), "utf8");
    issues.push(...codeReferenceIssues(repo, document, source));
  }
  expect(issues).toEqual([]);
});

test("slugs follow GitHub's heading anchors", () => {
  expect(slugify("Access Epoch")).toBe("access-epoch");
  expect(slugify("`kek-log` & Bridges — v2")).toBe("kek-log--bridges--v2");
  expect(slugify("**Bold** _emphasis_ snake_case")).toBe(
    "bold-emphasis-snake_case",
  );
  expect(slugify("[Linked](./x.md) heading")).toBe("linked-heading");
  const anchors = headingAnchors(
    '# Title\n\n## Repeat\n\n## Repeat\n\nSetext\n------\n\n<a id="pinned"></a>\n\n```md\n## Not a heading\n```\n',
  );
  expect([...anchors].sort()).toEqual(
    ["pinned", "repeat", "repeat-1", "setext", "title"].sort(),
  );
});

test("links inside code are ignored", () => {
  const targets = markdownTargets(
    'Use `[x](missing.md)` and\n\n```\n[y](missing.md)\n```\n\n[z](real.md "Title") <https://example.org/a> https://example.net/b.\n',
  );
  expect(targets.map((target) => target.target)).toEqual([
    "real.md",
    "https://example.org/a",
    "https://example.net/b",
  ]);
});

test("broken files, fragments, lines, and repository URLs fail", () => {
  const { lint } = fixture({
    "docs/guide.md": [
      "# Guide",
      "",
      "[ok](./other.md#second-part) [dir](../src/) [line](../src/a.ts#L2)",
      "[missing](./nope.md) [anchor](./other.md#nope) [self](#nope)",
      "[past](../src/a.ts#L9) [escape](../../outside.md)",
      "[remote](https://github.com/a2f0/tearleads/blob/main/docs/gone.md)",
      "",
    ].join("\n"),
    "docs/other.md": "# Other\n\n## Second Part\n",
    "src/a.ts": "export {};\n// two\n",
  });
  const result = lint();
  expect(result.code).toBe(1);
  expect(result.output).toContain("./nope.md: target does not exist");
  expect(result.output).toContain(
    "no heading or anchor #nope in docs/other.md",
  );
  expect(result.output).toContain(
    "no heading or anchor #nope in docs/guide.md",
  );
  expect(result.output).toContain("line 9 is past the end of src/a.ts");
  expect(result.output).toContain("link leaves the repository");
  expect(result.output).toContain("docs/gone.md: target does not exist");
  expect(result.output).not.toContain("second-part:");
  expect(result.output).toContain("6 documentation link problem(s)");
});

test("code references in published docs must be links, and --fix links them", () => {
  const source = [
    "See `src/a.ts`, `src/a.ts:2`, `src/`, `src/{a,b}.ts`, `src/<name>.ts`,",
    "`missing/file.ts`, and [`src/a.ts`](../src/a.ts).",
    "",
  ].join("\n");
  const { cwd, lint } = fixture({
    "docs/guide.md": source,
    "notes/guide.md": source,
    "src/a.ts": "export {};\n// two\n",
  });
  const failed = lint();
  expect(failed.code).toBe(1);
  expect(failed.output).toContain("docs/guide.md:1:5 src/a.ts: unlinked");
  expect(failed.output).not.toContain("notes/guide.md");
  expect(failed.output).toContain("3 documentation link problem(s)");

  const fixed = lint("--fix");
  expect(fixed.code).toBe(0);
  expect(readFileSync(join(cwd, "docs/guide.md"), "utf8")).toBe(
    [
      "See [`src/a.ts`](../src/a.ts), [`src/a.ts:2`](../src/a.ts#L2), [`src/`](../src/), `src/{a,b}.ts`, `src/<name>.ts`,",
      "`missing/file.ts`, and [`src/a.ts`](../src/a.ts).",
      "",
    ].join("\n"),
  );
});

test("linking is idempotent", () => {
  const repo = repositoryFiles("/", ["src/a.ts"]);
  const once = linkCodeReferences(repo, "docs/x.md", "Read `src/a.ts`.\n");
  expect(linkCodeReferences(repo, "docs/x.md", once)).toBe(once);
});

test("external probes fail only on proven dead links", async () => {
  const live = Bun.serve({
    port: 0,
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/" || pathname === "/ok") return new Response("ok");
      if (pathname === "/head-only-fails" && request.method === "GET") {
        return new Response("ok");
      }
      if (pathname === "/private") return new Response("", { status: 403 });
      return new Response("", { status: pathname === "/gone" ? 410 : 404 });
    },
  });
  // A bot wall that answers 404 everywhere, home page included.
  const walled = Bun.serve({
    port: 0,
    fetch: () => new Response("", { status: 404 }),
  });
  try {
    const link = (url: string) => ({ file: "docs/x.md", line: 1, url });
    const results = await probeExternalLinks(
      [
        link(`${live.url}ok#section`),
        link(`${live.url}head-only-fails`),
        link(`${live.url}missing`),
        link(`${live.url}gone`),
        link(`${live.url}private`),
        link(`${walled.url}page`),
        link("https://example.com/never-probed"),
      ],
      { skipHosts: /^example\.com$/ },
    );
    expect(
      Object.fromEntries(
        results.map((result) => [new URL(result.url).pathname, result.status]),
      ),
    ).toEqual({
      "/ok": "ok",
      "/head-only-fails": "ok",
      "/missing": "broken",
      "/gone": "broken",
      "/private": "unverified",
      "/page": "unverified",
    });
  } finally {
    live.stop(true);
    walled.stop(true);
  }
});
