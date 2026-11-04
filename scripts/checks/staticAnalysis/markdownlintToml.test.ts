import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(
  import.meta.dir,
  "../../../node_modules/markdownlint-cli2/markdownlint-cli2-bin.mjs",
);

function lint(config: string, markdown: string, ignored = false) {
  const cwd = mkdtempSync(join(tmpdir(), "tearleads-markdownlint-toml-"));
  try {
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "pyproject.toml"), config);
    writeFileSync(join(cwd, "docs/check.md"), markdown);
    if (ignored)
      writeFileSync(join(cwd, "docs/ignored.md"), "#Missing space\n");
    const result = Bun.spawnSync(
      [
        process.execPath,
        cli,
        "--config",
        "pyproject.toml",
        "--configPointer",
        "/tool/markdownlint-cli2",
        "docs/*.md",
      ],
      { cwd, stdout: "pipe", stderr: "pipe" },
    );
    return {
      code: result.exitCode,
      output: result.stdout.toString() + result.stderr.toString(),
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("TOML rule tables preserve a custom limit and heading exemption", () => {
  const result = lint(
    `[tool.markdownlint-cli2.config]
default = false
[tool.markdownlint-cli2.config.MD013]
line_length = 12
headings = false
code_blocks = false
`,
    "# Heading is exempt\n\nThis paragraph exceeds twelve columns.\n",
  );
  expect(result.code).toBe(1);
  expect(result.output).toContain("MD013/line-length");
  expect(result.output).toContain("check.md:3");
  expect(result.output).not.toContain("check.md:1");
});

test("TOML enabled=false retains a disabled rule", () => {
  const result = lint(
    `[tool.markdownlint-cli2.config]
default = false
[tool.markdownlint-cli2.config.MD018]
enabled = false
`,
    "#Missing space\n",
  );
  expect(result.code).toBe(0);
});

test("TOML CLI options retain glob ignores", () => {
  const result = lint(
    `[tool.markdownlint-cli2]
ignores = ["docs/ignored.md"]
[tool.markdownlint-cli2.config]
default = false
MD018 = true
`,
    "# Good\n",
    true,
  );
  expect(result.code).toBe(0);
  expect(result.output).toContain("Linting: 1 file");
});

test("malformed TOML remains a configuration failure", () => {
  const result = lint("[tool.markdownlint-cli2]\nignores = [\n", "# Good\n");
  expect(result.code).not.toBe(0);
  expect(result.output).toMatch(
    /Unable to use configuration file.*Invalid TOML document: invalid value/,
  );
});

test("repeated reversed links retain RE2JS lookbehind matching", () => {
  const result = lint(
    `[tool.markdownlint-cli2.config]
default = false
MD011 = true
`,
    "(https://example.com)[first]\n(https://example.org)[second]\n",
  );
  expect(result.code).toBe(1);
  expect(result.output).toContain("check.md:1");
  expect(result.output).toContain("check.md:2");
  expect(result.output.match(/MD011\/no-reversed-links/g)).toHaveLength(2);
});

test("Unicode link labels retain RE2JS whitespace detection", () => {
  const config = `[tool.markdownlint-cli2.config]
default = false
MD039 = true
`;
  const invalid = lint(config, "[ 😀 label ](https://example.com)\n");
  expect(invalid.code).toBe(1);
  expect(invalid.output).toContain("MD039/no-space-in-links");
  expect(lint(config, "[😀 label](https://example.com)\n").code).toBe(0);
});
