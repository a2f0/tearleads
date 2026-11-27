import { expect, test } from "bun:test";
import { parseStatementOptions } from "./options";

test("runs named files in one package", () => {
  expect(
    parseStatementOptions([
      "--package",
      "api",
      "--file",
      "src/a.test.ts",
      "--file",
      "./src/b.test.ts",
      "--name",
      "budget",
      "--param-hash",
      "--client-statements",
      "--limit",
      "500",
    ]),
  ).toEqual({
    mode: "run",
    package: "api",
    files: ["src/a.test.ts", "./src/b.test.ts"],
    name: "budget",
    paramHash: true,
    clientStatements: true,
    limit: 500,
  });
  expect(
    parseStatementOptions(["--package", "app", "--file", "x.test.tsx"]),
  ).toMatchObject({
    name: null,
    paramHash: false,
    clientStatements: false,
    limit: null,
  });
  expect(parseStatementOptions(["--help"])).toBeNull();
});

test("summarizes a saved capture without running tests", () => {
  expect(parseStatementOptions(["--summarize", "c.jsonl"])).toEqual({
    mode: "summarize",
    capture: "c.jsonl",
  });
  for (const flag of [
    ["--package", "api"],
    ["--file", "a.test.ts"],
    ["--name", "budget"],
    ["--param-hash"],
    ["--client-statements"],
    ["--limit", "5"],
  ])
    expect(() =>
      parseStatementOptions(["--summarize", "c.jsonl", ...flag]),
    ).toThrow(/runs no tests/);
});

test("rejects a missing or unsafe package, no files, and stray arguments", () => {
  expect(() => parseStatementOptions(["--file", "a.test.ts"])).toThrow(
    /--package/,
  );
  expect(() =>
    parseStatementOptions(["--package", "../api", "--file", "a.test.ts"]),
  ).toThrow(/--package/);
  expect(() => parseStatementOptions(["--package", "api"])).toThrow(/--file/);
  expect(() =>
    parseStatementOptions(["--package", "api", "src/a.test.ts"]),
  ).toThrow(/--file/);
  expect(() =>
    parseStatementOptions([
      "--package",
      "api",
      "--file",
      "a.test.ts",
      "--limit",
      "0",
    ]),
  ).toThrow(/--limit/);
});
