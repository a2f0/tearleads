import { expect, test } from "bun:test";
import { isValidEnvFileVariableName, parseEnvFileText } from "./envFile";

test("env file text parser imports only POSIX variable names", () => {
  expect(
    parseEnvFileText(
      [
        "API_TOKEN=secret",
        "BAD KEY=ignored",
        "1BAD=ignored",
        "export DEBUG=true",
        "_INTERNAL=enabled",
        "# a comment",
      ].join("\n"),
    ),
  ).toEqual([
    { key: "API_TOKEN", value: "secret" },
    { key: "DEBUG", value: "true" },
    { key: "_INTERNAL", value: "enabled" },
  ]);
});

test("variable-name validation accepts POSIX names only", () => {
  expect(isValidEnvFileVariableName("API_TOKEN")).toBe(true);
  expect(isValidEnvFileVariableName("_INTERNAL")).toBe(true);
  expect(isValidEnvFileVariableName("1BAD")).toBe(false);
  expect(isValidEnvFileVariableName("BAD KEY")).toBe(false);
});

test("parser unquotes matching quotes and keeps everything after the first =", () => {
  expect(
    parseEnvFileText(
      [
        'QUOTED="a b"',
        "SINGLE='c'",
        "MIXED=\"d'",
        "URL=postgres://u:p@h/db?x=1",
        "EMPTY=",
        "NO_EQUALS",
      ].join("\r\n"),
    ),
  ).toEqual([
    { key: "QUOTED", value: "a b" },
    { key: "SINGLE", value: "c" },
    { key: "MIXED", value: "\"d'" },
    { key: "URL", value: "postgres://u:p@h/db?x=1" },
    { key: "EMPTY", value: "" },
  ]);
});
