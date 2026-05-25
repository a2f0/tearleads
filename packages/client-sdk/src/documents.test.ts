import { expect, test } from "bun:test";
import {
  createDocumentProjectorRegistry,
  type DocumentFieldValidationIssue,
  type DocumentProjectorDefinition,
  deriveStoredDocumentTitle,
  getDocumentClientProjectionTables,
  getStoredDocumentTypeLabel,
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

test("document helpers accept projector definitions directly", () => {
  const definitions: ReadonlyArray<DocumentProjectorDefinition> = [
    {
      clientProjection: {
        save: () => {},
        tables: [
          {
            createSql: `CREATE TABLE IF NOT EXISTS "claim_projection" ("id" TEXT PRIMARY KEY)`,
            name: "claim_projection",
          },
        ],
      },
      kind: "claim",
      label: "claim",
    },
  ];

  expect(getStoredDocumentTypeLabel("claim", definitions)).toBe("claim");
  expect(getDocumentClientProjectionTables(definitions)).toHaveLength(1);
});

test("document helpers handle null projector input at runtime", () => {
  expect(
    getDocumentClientProjectionTables(
      null as unknown as Parameters<
        typeof getDocumentClientProjectionTables
      >[0],
    ),
  ).toEqual([]);
});
