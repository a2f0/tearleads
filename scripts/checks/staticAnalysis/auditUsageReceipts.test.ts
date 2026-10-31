import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const guidePath = "docs/developer/audit-usage-receipts.md";
const skills = [
  "database-efficiency-audit",
  "protocol-efficiency-audit",
  "protocol-security-audit",
];

function shellExample(name: string): string {
  const guide = readFileSync(`${root}/${guidePath}`, "utf8");
  const blocks = [...guide.matchAll(/```sh\n([\s\S]*?)```/g)];
  const block = blocks.find((match) =>
    match[1]?.startsWith(`# ${name}\n`),
  )?.[1];
  expect(block).toBeDefined();
  if (!block) throw new Error(`Missing shell example ${name}`);
  return block;
}

function receiptTemplate(): string {
  const guide = readFileSync(`${root}/${guidePath}`, "utf8");
  const body = guide.match(/```markdown\n([\s\S]*?)```/)?.[1];
  if (!body) throw new Error("Missing receipt template");
  return body.replaceAll("RUN_ID", "fixture");
}

function fixtureRun(command: string, fixture: unknown) {
  // Preserve the pinned jq on PATH; this fixture never uses live gh.
  const { PATH, HOME } = process.env;
  const directory = mkdtempSync(resolve(tmpdir(), "audit-usage-fixture-"));
  try {
    const source = resolve(directory, "source.json");
    const report = resolve(directory, "report.md");
    writeFileSync(source, JSON.stringify(fixture));
    writeFileSync(report, receiptTemplate());
    return Bun.spawnSync(["sh", "-c", command], {
      env: {
        PATH,
        HOME,
        USAGE_FILE: source,
        MOCK_RESPONSE: source,
        REPORT: report,
        AUDIT_DIR: directory,
        REPO: "fixture/audit",
        ISSUE: "123",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// These numbers are synthetic parser fixtures, never audit evidence. The shape
// follows Hermes oneshot.py _USAGE_KEYS / _auxiliary_report, linked in the guide.
test("usage inspection keeps native counters and rollups separate", () => {
  const usage = {
    input_tokens: 12,
    output_tokens: 4,
    cache_read_tokens: 6,
    cache_write_tokens: 0,
    reasoning_tokens: 2,
    total_tokens: 16,
    api_calls: 1,
    completed: false,
    partial: true,
    interrupted: true,
    auxiliary: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
    total_including_auxiliary: { total_tokens: 20, api_calls: 2 },
  };
  const result = fixtureRun(shellExample("usage-inspection"), {
    ...usage,
    session_id: "private-session",
    failure: "private error payload",
    model: "unreviewed model metadata",
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toEqual(usage);
});

test("missing usage is null, not fabricated zero", () => {
  const result = fixtureRun(shellExample("usage-inspection"), {});
  expect(result.exitCode).toBe(0);
  expect(Object.values(JSON.parse(result.stdout.toString()))).toEqual(
    Array(12).fill(null),
  );
});

// Intercept gh with a strict shell function: no network or real issue writes.
const readbackFixture = `gh() {
  test "$*" = 'api repos/fixture/audit/issues/123' || exit 97
  cat "$MOCK_RESPONSE"
}
`;
for (const [name, body, pullRequest, code] of [
  ["exact body", receiptTemplate(), null, 0],
  ["wrong body", "different receipt", null, 1],
  ["missing body", null, null, 1],
  ["pull request", receiptTemplate(), {}, 1],
] as const) {
  test(`readback validates ${name}`, () => {
    const result = fixtureRun(
      readbackFixture + shellExample("issue-readback"),
      {
        body,
        pull_request: pullRequest,
        html_url: "https://github.com/fixture/audit/issues/123",
      },
    );
    expect(result.exitCode).toBe(code);
    expect(result.stdout.toString().includes("https://github.com/")).toBe(
      code === 0,
    );
  });
}

test("failed readback cannot report success", () => {
  const result = fixtureRun(
    `gh() { return 23; }\n${shellExample("issue-readback")}`,
    {},
  );
  expect(result.exitCode).toBe(23);
  expect(result.stdout.toString()).toBe("");
});

for (const harness of [".claude", ".agents"]) {
  for (const skill of skills) {
    test(`${harness}/${skill} captures usage before work and when publishing`, () => {
      const directory = `${harness}/skills/${skill}`;
      const text = readFileSync(`${root}/${directory}/SKILL.md`, "utf8");
      const reference = "../../../docs/developer/audit-usage-receipts.md";
      expect(text.indexOf("## Arguments")).toBeGreaterThanOrEqual(0);
      expect(text.indexOf(". Report")).toBeGreaterThanOrEqual(0);
      expect(text.indexOf(reference)).toBeGreaterThan(0);
      expect(text.indexOf(reference)).toBeLessThan(
        text.indexOf("## Arguments"),
      );
      expect(text.lastIndexOf(reference)).toBeGreaterThan(
        text.indexOf(". Report"),
      );
      const files = ["SKILL.md", "references/issue-template.md"];
      // Security intentionally stays Claude-batched versus full-scope .agents.
      if (harness !== ".agents" || skill !== "protocol-security-audit") {
        files.push("references/batching.md");
      }
      for (const file of files) {
        const path = `${root}/${directory}/${file}`;
        const content = readFileSync(path, "utf8");
        const matches = [...content.matchAll(/\]\(([^)]+audit-usage[^)]*)\)/g)];
        expect(matches.length).toBeGreaterThan(0);
        for (const match of matches) {
          expect(resolve(path, "..", match[1]?.split("#")[0] ?? "")).toBe(
            `${root}/${guidePath}`,
          );
        }
      }
    });
  }
}
