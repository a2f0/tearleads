import { expect, test } from "bun:test";
import { formatStatementSummary } from "./markdown";
import { summarizeCapture } from "./summary";

test("renders phases, labels, top statements and same-key repeats", () => {
  const markdown = formatStatementSummary(
    summarizeCapture([
      { label: "t", sql: "select a | b", params: 1, paramHash: "k" },
      { label: "t", sql: "select a | b", params: 1, paramHash: "k" },
      { phaseEnd: "phase", requests: 2 },
      {
        label: "t",
        sql: `select '${"x".repeat(300)}'`,
        params: 0,
        paramHash: "z",
      },
      { truncated: 3 },
    ]),
    "Intro.",
  );
  expect(markdown).toContain("Intro.\n3 statements.");
  expect(markdown).toContain("every count is a lower bound");
  expect(markdown).toContain("| phase | 2 | 2 | 1.0 |");
  expect(markdown).toContain("| t | 3 | 0 |");
  expect(markdown).toContain("| 2 | `select a \\| b` |");
  expect(markdown).toContain("| t | 1 | `select a \\| b` |");
  expect(markdown).toContain("…` |");
  expect(markdown).not.toContain("x".repeat(250));
});

test("leaves out sections the capture cannot support", () => {
  const markdown = formatStatementSummary(
    summarizeCapture([{ label: "t", sql: "select 1", params: 0 }]),
    "Intro.",
  );
  expect(markdown).not.toContain("## Phases");
  expect(markdown).not.toContain("## Same-key repeats");
  expect(markdown).not.toContain("lower bound");
});
