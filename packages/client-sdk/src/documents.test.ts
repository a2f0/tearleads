import { expect, test } from "bun:test";
import {
  createDocumentProjectorRegistry,
  type DocumentFieldValidationIssue,
  deriveStoredDocumentTitle,
  readStringDocumentField,
} from "./documents";

test("documents facade exports document projector helpers", () => {
  const registry = createDocumentProjectorRegistry([
    {
      kind: "claim",
      untitledTitle: "Untitled claim",
    },
  ]);
  const issues: DocumentFieldValidationIssue[] = [];

  expect(registry.getUntitledDocumentTitle("claim")).toBe("Untitled claim");
  expect(readStringDocumentField({ claimId: "C-1" }, "claimId", issues)).toBe(
    "C-1",
  );
  expect(issues).toEqual([]);
  expect(deriveStoredDocumentTitle("Hello\nworld")).toBe("Hello");
});
