import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const guidePath = "docs/developer/combined-efficiency-audits.md";
const skills = ["database-efficiency-audit", "protocol-efficiency-audit"];
const harnesses = [".claude", ".agents"];
const linkedFiles = [
  "SKILL.md",
  "references/batching.md",
  "references/issue-template.md",
];

function skillFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, resolve(entry.parentPath, entry.name)))
    .sort();
}

function guideLinks(path: string): string[] {
  const content = readFileSync(path, "utf8");
  return [
    ...content.matchAll(/\]\(([^)]+combined-efficiency-audits[^)]*)\)/g),
  ].map((match) => match[1] ?? "");
}

for (const harness of harnesses) {
  for (const skill of skills) {
    test(`${harness}/${skill} links the combined-run guide`, () => {
      const directory = `${root}/${harness}/skills/${skill}`;
      for (const file of linkedFiles) {
        const path = `${directory}/${file}`;
        const links = guideLinks(path);
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) {
          expect(resolve(path, "..", link.split("#")[0] ?? "")).toBe(
            `${root}/${guidePath}`,
          );
        }
      }
      const text = readFileSync(`${directory}/SKILL.md`, "utf8");
      const start = text.indexOf("## Arguments");
      const argumentsSection = text.slice(
        start,
        text.indexOf("\n## ", start + 1),
      );
      expect(argumentsSection).toContain("`draft-only`");
      expect(argumentsSection).toContain("`reconcile <other-audit-directory>`");
    });
  }
}

// An efficiency-audit lesson must reach every harness: unlike the security
// audit, these two skills have no intended difference between the copies.
for (const skill of skills) {
  test(`${skill} is identical in every harness copy`, () => {
    const [first, ...rest] = harnesses.map(
      (harness) => `${root}/${harness}/skills/${skill}`,
    );
    if (!first) throw new Error("No harness copies configured");
    const files = skillFiles(first);
    expect(files.length).toBeGreaterThan(0);
    for (const copy of rest) {
      expect(skillFiles(copy)).toEqual(files);
      for (const file of files) {
        expect(readFileSync(`${copy}/${file}`, "utf8")).toBe(
          readFileSync(`${first}/${file}`, "utf8"),
        );
      }
    }
  });
}

test("the combined-run guide defines the drafts both skills write", () => {
  const guide = readFileSync(`${root}/${guidePath}`, "utf8");
  for (const name of [
    "issue.md",
    "issue-title.txt",
    "proposals.json",
    "leads-for-other-audit.md",
    "cross-audit.md",
  ]) {
    expect(guide).toContain(`\`${name}\``);
  }
  for (const heading of [
    "## Hand-off rule",
    "## Draft mode",
    "## Reconciliation batch",
    "## One unified issue",
  ]) {
    expect(guide).toContain(`\n${heading}\n`);
  }
});
