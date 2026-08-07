import { expect, test } from "bun:test";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import {
  createFileDocumentType,
  readFileDocumentFieldsFromRecord,
} from "./fileDocumentDefinition";

const definition = createFileDocumentType({
  createIcon: FileIcon,
  createLabel: "File",
  kind: "test_file",
  label: "file",
  readFields: readFileDocumentFieldsFromRecord,
  untitledTitle: "Untitled file",
});

function project(fileName: string) {
  const projector = definition.project;
  if (projector === undefined) {
    throw new Error("File document factory must define a projector.");
  }

  return projector({
    documentKind: "test_file",
    structuredFields: {
      byteLength: "42",
      fileName,
      mimeType: "application/octet-stream",
      sourceLastModified: "2026-08-07T00:00:00.000Z",
    },
    text: "",
  });
}

test("file document factory projects validated fields and filename title", () => {
  expect(project("report.bin")).toEqual({
    fieldValidationIssues: [],
    structuredFields: {
      byteLength: "42",
      fileName: "report.bin",
      mimeType: "application/octet-stream",
      sourceLastModified: "2026-08-07T00:00:00.000Z",
    },
    title: "report.bin",
  });
});

test("file document factory falls back when the filename is blank", () => {
  expect(project("  ").title).toBe("Untitled file");
});
