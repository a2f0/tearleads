import { expect, test } from "bun:test";
import type {
  DocumentProjection,
  DocumentRowSummary,
} from "@tearleads/client-sdk";
import {
  envFileDocumentProjectorDefinition,
  isValidEnvFileVariableName,
  parseEnvFileText,
} from "./envFileDocumentDefinition";

function project(
  structuredFields: Record<string, string>,
  rows: DocumentRowSummary[],
): DocumentProjection {
  const projector = envFileDocumentProjectorDefinition.project;
  if (!projector) {
    throw new Error("env file projector is not defined");
  }
  return projector({
    documentKind: "env_file",
    structuredFields,
    text: "",
    rows,
  });
}

function variable(
  id: string,
  fields: Record<string, string>,
): DocumentRowSummary {
  return { id, fields };
}

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

test("title uses the file name when present", () => {
  const projection = project({ fileName: ".env.local" }, [
    variable("v1", { key: "API_URL", value: "https://api.example.test" }),
  ]);

  expect(projection.title).toBe(".env.local");
  expect(projection.structuredFields).toEqual({ fileName: ".env.local" });
  expect(projection.fieldValidationIssues).toEqual([]);
});

test("title defaults to the document type name when unnamed", () => {
  const projection = project({ fileName: "" }, [
    variable("v1", { key: "API_URL", value: "x" }),
    variable("v2", { key: "", value: "" }),
  ]);

  expect(projection.title).toBe("Untitled .env file");
});

test("malformed variable keys surface as validation issues", () => {
  const projection = project({ fileName: "" }, [
    variable("v1", { key: "1BAD", value: "bad" }),
    variable("v2", { key: "BAD KEY", value: "bad" }),
  ]);

  expect(projection.fieldValidationIssues).toEqual([
    {
      field: "rows[0].key",
      message: "Expected an environment variable key like API_TOKEN.",
      value: "1BAD",
    },
    {
      field: "rows[1].key",
      message: "Expected an environment variable key like API_TOKEN.",
      value: "BAD KEY",
    },
  ]);
});
