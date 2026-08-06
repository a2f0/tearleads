import {
  and,
  asc,
  count,
  desc,
  eq,
  notInArray,
  type SQL,
  sql,
} from "drizzle-orm";
import { HIDDEN_DOCUMENT_SUMMARY_KINDS } from "../../../documentSummary";
import { documentProjection, documents } from "../../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import type {
  DocumentSummaryList,
  DocumentSummarySort,
  ListDocumentSummariesInput,
} from "../types";
import {
  documentSummaryJoin,
  documentSummarySelection,
  mapDocumentSummary,
} from "./documentProjectionRows";

const DEFAULT_DOCUMENT_SUMMARY_SORT: DocumentSummarySort = {
  direction: "desc",
  key: "updated",
};

function normalizeDocumentSummaryWindowValue(
  value: number | undefined,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

function normalizeDocumentSummarySort(
  sort: DocumentSummarySort | undefined,
): DocumentSummarySort {
  if (
    !sort ||
    (sort.direction !== "asc" && sort.direction !== "desc") ||
    !["kind", "title", "updated"].includes(sort.key)
  ) {
    return DEFAULT_DOCUMENT_SUMMARY_SORT;
  }

  return sort;
}

function getDocumentSummaryFilters(
  input: ListDocumentSummariesInput,
): SQL | undefined {
  const conditions: SQL[] = [
    notInArray(documentProjection.documentKind, [
      ...HIDDEN_DOCUMENT_SUMMARY_KINDS,
    ]),
  ];
  if (input.documentKind) {
    conditions.push(eq(documentProjection.documentKind, input.documentKind));
  }

  return and(...conditions);
}

function getDocumentSummaryOrderBy(
  sort: DocumentSummarySort | undefined,
): SQL[] {
  const normalizedSort = normalizeDocumentSummarySort(sort);
  const order =
    normalizedSort.direction === "asc"
      ? {
          column: asc,
        }
      : {
          column: desc,
        };

  switch (normalizedSort.key) {
    case "kind":
      return [
        order.column(documentProjection.documentKind),
        order.column(documentProjection.localId),
      ];
    case "title":
      return [
        order.column(sql`${documentProjection.title} COLLATE NOCASE`),
        order.column(documentProjection.localId),
      ];
    case "updated":
      return [
        order.column(documentProjection.updatedAt),
        order.column(documentProjection.localId),
      ];
  }
}

export async function listDocumentSummaries(
  execSql: ExecSql,
  input: ListDocumentSummariesInput = {},
): Promise<DocumentSummaryList> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const filters = getDocumentSummaryFilters(input);
  const normalizedOffset = normalizeDocumentSummaryWindowValue(input.offset);
  const normalizedLimit =
    input.limit === undefined
      ? null
      : normalizeDocumentSummaryWindowValue(input.limit);
  const totalCountRows = await db
    .select({ totalCount: count() })
    .from(documentProjection)
    .where(filters);
  const rowQuery = db
    .select(documentSummarySelection)
    .from(documentProjection)
    .leftJoin(documents, documentSummaryJoin)
    .where(filters)
    .orderBy(...getDocumentSummaryOrderBy(input.sort));
  const rows =
    normalizedLimit === null
      ? normalizedOffset === 0
        ? await rowQuery
        : await rowQuery.limit(-1).offset(normalizedOffset)
      : await rowQuery.limit(normalizedLimit).offset(normalizedOffset);

  return {
    rows: rows.map(mapDocumentSummary),
    totalCount: totalCountRows[0]?.totalCount ?? 0,
  };
}
