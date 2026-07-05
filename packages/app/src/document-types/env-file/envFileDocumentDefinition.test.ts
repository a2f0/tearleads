import { expect, test } from "bun:test";
import {
  initializeStoredDocumentKind as initializeStoredDocumentKindBase,
  readStoredDocumentState as readStoredDocumentStateBase,
  type StructuredDocumentShape,
  writeStoredDocumentFields as writeStoredDocumentFieldsBase,
} from "@tearleads/client-sdk";
import { createDocument } from "@tearleads/loro";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../projectors";
import {
  parseEnvFileText,
  readEnvFileFieldsFromRecord,
  serializeEnvFileVariables,
} from "./envFileDocumentDefinition";

function initializeEnvFileDocument(doc: StructuredDocumentShape): void {
  initializeStoredDocumentKindBase(
    doc,
    "env_file",
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
}

function readStoredDocumentState(doc: StructuredDocumentShape) {
  return readStoredDocumentStateBase(doc, APP_DOCUMENT_PROJECTOR_DEFINITIONS);
}

function writeEnvFileFields(
  doc: StructuredDocumentShape,
  patch: Readonly<Record<string, string | undefined>>,
): void {
  writeStoredDocumentFieldsBase(
    doc,
    "env_file",
    patch,
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
}

function readEnvFileDocument(doc: StructuredDocumentShape) {
  return readEnvFileFieldsFromRecord(
    readStoredDocumentState(doc).structuredFields,
  );
}

test("env file fields are stored as first-class Loro state", async () => {
  const doc = await createDocument("env-file-fields");
  const variablesJson = serializeEnvFileVariables([
    {
      id: "env-1-api-url",
      key: "API_URL",
      value: "https://api.example.test",
    },
    {
      id: "env-2-debug",
      key: "DEBUG",
      value: "true",
    },
  ]);

  initializeEnvFileDocument(doc);
  writeEnvFileFields(doc, {
    fileName: ".env.local",
    variablesJson,
  });

  expect(readEnvFileDocument(doc)).toEqual({
    fields: {
      fileName: ".env.local",
      variables: [
        {
          id: "env-1-api-url",
          key: "API_URL",
          value: "https://api.example.test",
        },
        {
          id: "env-2-debug",
          key: "DEBUG",
          value: "true",
        },
      ],
      variablesJson,
    },
    issues: [],
  });
  expect(readStoredDocumentState(doc)).toMatchObject({
    documentKind: "env_file",
    structuredFields: {
      fileName: ".env.local",
      variablesJson,
    },
    title: ".env.local",
  });
});

test("env file text parser imports only POSIX variable names", () => {
  expect(
    parseEnvFileText(
      [
        "API_TOKEN=secret",
        "BAD KEY=ignored",
        "1BAD=ignored",
        "export DEBUG=true",
        "_INTERNAL=enabled",
      ].join("\n"),
    ),
  ).toEqual([
    {
      id: "env-1-api_token",
      key: "API_TOKEN",
      value: "secret",
    },
    {
      id: "env-4-debug",
      key: "DEBUG",
      value: "true",
    },
    {
      id: "env-5-_internal",
      key: "_INTERNAL",
      value: "enabled",
    },
  ]);
});

test("env file validation reports malformed variable keys", async () => {
  const doc = await createDocument("invalid-env-file");
  const variablesJson = serializeEnvFileVariables([
    {
      id: "env-1-bad",
      key: "1BAD",
      value: "bad",
    },
    {
      id: "env-2-bad-space",
      key: "BAD KEY",
      value: "bad",
    },
  ]);

  writeEnvFileFields(doc, { variablesJson });

  expect(readEnvFileDocument(doc)).toEqual({
    fields: {
      fileName: "",
      variables: [
        {
          id: "env-1-bad",
          key: "1BAD",
          value: "bad",
        },
        {
          id: "env-2-bad-space",
          key: "BAD KEY",
          value: "bad",
        },
      ],
      variablesJson,
    },
    issues: [
      {
        field: "variablesJson[0].key",
        message: "Expected an environment variable key like API_TOKEN.",
        value: "1BAD",
      },
      {
        field: "variablesJson[1].key",
        message: "Expected an environment variable key like API_TOKEN.",
        value: "BAD KEY",
      },
    ],
  });
});
