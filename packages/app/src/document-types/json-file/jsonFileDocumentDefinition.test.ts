import { expect, test } from "bun:test";
import {
  initializeStoredDocumentKind as initializeStoredDocumentKindBase,
  readStoredDocumentState as readStoredDocumentStateBase,
  type StructuredDocumentShape,
  writeStoredDocumentFields as writeStoredDocumentFieldsBase,
} from "@tearleads/client-sdk";
import { createDocument } from "@tearleads/loro";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../projectors";

function initializeJsonFileDocument(doc: StructuredDocumentShape): void {
  initializeStoredDocumentKindBase(
    doc,
    "json_file",
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
}

function readStoredDocumentState(doc: StructuredDocumentShape) {
  return readStoredDocumentStateBase(doc, APP_DOCUMENT_PROJECTOR_DEFINITIONS);
}

function writeJsonFileFields(
  doc: StructuredDocumentShape,
  patch: Readonly<Record<string, string | undefined>>,
): void {
  writeStoredDocumentFieldsBase(
    doc,
    "json_file",
    patch,
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
}

test("JSON file fields derive titles from filename independently of raw JSON text", async () => {
  const rawJson = '{\n  "enabled": true\n}';
  const doc = await createDocument("json-file-document");

  initializeJsonFileDocument(doc);
  doc.getText("text").update(rawJson);
  writeJsonFileFields(doc, {
    fileName: "config.json",
  });

  expect(readStoredDocumentState(doc)).toMatchObject({
    documentKind: "json_file",
    structuredFields: {
      fileName: "config.json",
    },
    text: rawJson,
    title: "config.json",
  });

  writeJsonFileFields(doc, {
    fileName: "renamed.json",
  });

  expect(readStoredDocumentState(doc)).toMatchObject({
    text: rawJson,
    title: "renamed.json",
  });
});
