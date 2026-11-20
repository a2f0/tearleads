import { isDeepStrictEqual } from "node:util";
import {
  type DocumentAttachment,
  type DocumentSnapshot,
  projectStoredDocumentState,
} from "@tearleads/client-sdk";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  type continuityDocuments,
} from "app/continuity";

type Fixture = ReturnType<typeof continuityDocuments>[number];

export function checkDocument(
  fixture: Fixture,
  snapshot: Pick<
    DocumentSnapshot,
    | "seedTag"
    | "fieldValidationIssues"
    | "documentKind"
    | "rows"
    | "attachments"
    | "structuredFields"
    | "text"
  >,
  storedFields: Readonly<Record<string, unknown>>,
  seedTag: string,
  storedRows: readonly unknown[],
  storedMetadata: Readonly<Record<string, unknown>>,
) {
  const expected = projectStoredDocumentState(
    {
      documentKind: fixture.kind,
      text: fixture.text ?? "",
      structuredFields: fixture.fields ?? {},
      rows: fixture.rows?.map((fields, index) => ({
        fields,
        id: String(index),
      })),
    },
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
  if (
    snapshot.seedTag !== seedTag ||
    !isDeepStrictEqual(
      storedMetadata,
      fixture.kind === "note"
        ? {}
        : {
            kind: fixture.kind,
            schemaVersion:
              APP_DOCUMENT_PROJECTOR_DEFINITIONS.find(
                (definition) => definition.kind === fixture.kind,
              )?.schemaVersion ?? 1,
          },
    ) ||
    !isDeepStrictEqual(storedFields, fixture.fields ?? {}) ||
    storedRows.length !== (fixture.rows?.length ?? 0) ||
    storedRows.some((row, index) => {
      if (row === null || Array.isArray(row) || typeof row !== "object")
        return true;
      // The SDK assigns row IDs, timestamps and author metadata at creation.
      const fields = Object.fromEntries(
        Object.entries(row).filter(([key]) => !key.startsWith("@")),
      );
      return !isDeepStrictEqual(fields, fixture.rows?.[index]);
    }) ||
    snapshot.fieldValidationIssues.length > 0 ||
    snapshot.documentKind !== fixture.kind ||
    snapshot.text !== (fixture.text ?? "") ||
    !isDeepStrictEqual(expected.structuredFields, snapshot.structuredFields) ||
    snapshot.rows.length !== (fixture.rows?.length ?? 0) ||
    fixture.rows?.some(
      (row, index) => !isDeepStrictEqual(row, snapshot.rows[index]?.fields),
    ) ||
    snapshot.attachments.length !== fixture.attachments.length
  )
    throw new Error(`Fixture content differs: ${fixture.key}`);
}

/** The UI projection omits unreadable slots. The benchmark checks the stored map. */
export function checkStoredAttachments(
  fixtureKey: string,
  expected: ReadonlyArray<{ intent: DocumentAttachment }>,
  content: Readonly<Record<string, unknown>>,
) {
  const slots = Object.fromEntries(
    Object.entries(content).filter(([key]) => key.startsWith("attachment:")),
  );
  const expectedSlots = Object.fromEntries(
    expected.map(({ intent }, order) => {
      const { slotId, mimeType, ...metadata } = intent;
      return [
        `attachment:${slotId}`,
        { ...metadata, ...(mimeType === null ? {} : { mimeType }), order },
      ];
    }),
  );
  if (!isDeepStrictEqual(slots, expectedSlots))
    throw new Error(`Attachment metadata differs: ${fixtureKey}`);
}
