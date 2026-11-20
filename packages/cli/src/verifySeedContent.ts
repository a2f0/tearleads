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

const rootTypes = new Map([
  ["text", "Text"],
  ["content", "Map"],
  ["fields", "Map"],
  ["metadata", "Map"],
  ["rows", "List"],
]);

export function checkSeedRoots(
  fixtureKey: string,
  roots: Readonly<Record<string, string>>,
) {
  for (const [name, id] of Object.entries(roots)) {
    const type = rootTypes.get(name);
    if (!type || id !== `cid:root-${name}:${type}`)
      throw new Error(`Unexpected document root: ${fixtureKey} / ${name}`);
  }
}

/** Row IDs and attribution are generated when the seed is written. */
export function storedSeedRowsMatch(
  expected: NonNullable<Fixture["rows"]>,
  stored: readonly unknown[],
  userId: string,
) {
  const ids = new Set<string>();
  if (stored.length !== expected.length) return false;
  return stored.every((row, index) => {
    if (
      row === null ||
      Array.isArray(row) ||
      typeof row !== "object" ||
      !("@id" in row)
    )
      return false;
    const {
      "@id": id,
      "@createdAt": created,
      "@createdBy": creator,
      "@updatedAt": updated,
      "@updatedBy": updater,
      ...fields
    } = Object.fromEntries<unknown>(Object.entries(row));
    if (
      typeof id !== "string" ||
      !id ||
      ids.has(id) ||
      creator !== userId ||
      updater !== userId ||
      typeof created !== "string" ||
      !Number.isFinite(Date.parse(created)) ||
      new Date(created).toISOString() !== created ||
      updated !== created
    )
      return false;
    ids.add(id);
    return isDeepStrictEqual(fields, expected[index]);
  });
}

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
  seedTag: string,
  stored: {
    fields: Readonly<Record<string, unknown>>;
    metadata: Readonly<Record<string, unknown>>;
    rows: readonly unknown[];
    seedTag: unknown;
    textDelta: readonly unknown[];
  },
  userId: string,
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
    stored.seedTag !== seedTag ||
    !isDeepStrictEqual(
      stored.textDelta,
      fixture.text ? [{ insert: fixture.text }] : [],
    ) ||
    !isDeepStrictEqual(
      stored.metadata,
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
    !isDeepStrictEqual(stored.fields, fixture.fields ?? {}) ||
    !storedSeedRowsMatch(fixture.rows ?? [], stored.rows, userId) ||
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
  const { seedTag: _seedTag, ...slots } = content;
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
