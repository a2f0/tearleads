import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  DocumentEditAttributionRangeResponse,
  DocumentEditAttributionResponse,
  ListDocumentEditAttributionRangesResponse,
} from "@tearleads/validators/response";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type DocumentAttributionApi,
  loadReaderDocumentEditAttribution,
  readAttributionVoids,
} from "./attributionVoids";
import { loadDocumentAttributionRanges } from "./documentAttributionRanges";

const DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440e00";
const OTHER_DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440e01";

let close: () => void = () => undefined;
let execSql: ExecSql;

beforeEach(async () => {
  const database = await createTestExecSql(`voids-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await ensureDocumentTables(execSql);
});

afterEach(() => close());

async function recordVoid(input: {
  readonly attempts?: number;
  readonly documentId?: string;
  readonly judge?: string;
  readonly localId?: string;
  readonly stage?: string;
  readonly updateId: string;
}) {
  await execSql(
    `INSERT INTO document_void_updates (app_kind, local_id, document_id,
       update_id, stage, message, attempts, judge, voided_at)
     VALUES ('documents', ?, ?, ?, ?, 'void', ?, ?, '2026-11-23T00:00:00.000Z')`,
    [
      input.localId ?? "local-1",
      input.documentId ?? DOCUMENT_ID,
      input.updateId,
      input.stage ?? "loro_metadata",
      input.attempts ?? null,
      input.judge ?? documentVerdictJudge(),
    ],
  );
}

function range(
  updateId: string,
  peerId: string,
  startCounter: number,
  endCounter: number,
  writerUserId: string,
): DocumentEditAttributionRangeResponse {
  return {
    authorityKind: "direct",
    createdAt: "2026-11-23T00:00:00.000Z",
    endCounter,
    peerId,
    signedAt: "2026-11-23T00:00:00.000Z",
    startCounter,
    updateId,
    writerKeyFingerprint: `${writerUserId}-key`,
    writerUserId,
  } as DocumentEditAttributionRangeResponse;
}

/** An API serving `pages` of ranges and, for the compact list, `compact`. */
function api(
  pages: readonly (readonly DocumentEditAttributionRangeResponse[])[],
  compact: DocumentEditAttributionResponse | null = null,
) {
  const requests: {
    cursor?: string | null | undefined;
    expectedRevision?: number | undefined;
    limit?: number | undefined;
  }[] = [];
  const apiClient: DocumentAttributionApi = {
    getDocumentEditAttribution: async () => compact,
    listDocumentEditAttributionRanges: async (_documentId, options = {}) => {
      requests.push({ ...options });
      const index = Number(options.cursor ?? 0);
      const hasMore = index + 1 < pages.length;
      return {
        attributionRevision: 7,
        documentId: DOCUMENT_ID,
        hasMore,
        items: [...(pages[index] ?? [])],
        nextCursor: hasMore ? String(index + 1) : null,
      } as ListDocumentEditAttributionRangesResponse;
    },
  };
  return { apiClient, requests };
}

test("only a final void under the running judge leaves attribution", async () => {
  await recordVoid({ updateId: "import-void" });
  await recordVoid({ localId: "local-2", updateId: "other-record-void" });
  await recordVoid({ attempts: 3, stage: "loro_runtime", updateId: "spent" });
  await recordVoid({
    attempts: 1,
    stage: "loro_runtime",
    updateId: "unsettled",
  });
  await recordVoid({ judge: "void-rules-0:older", updateId: "older-judge" });
  await recordVoid({ documentId: OTHER_DOCUMENT_ID, updateId: "elsewhere" });

  expect(
    [...(await readAttributionVoids(execSql, DOCUMENT_ID))].sort(),
  ).toEqual(["import-void", "other-record-void", "spent"]);
  expect(await readAttributionVoids(null, DOCUMENT_ID)).toEqual(new Set());
});

test("a page of ranges leaves out a void update's ranges", async () => {
  await recordVoid({ updateId: "void" });
  const { apiClient } = api([
    [range("honest", "1", 0, 5, "bob"), range("void", "1", 5, 9, "mallory")],
  ]);

  const page = await loadDocumentAttributionRanges({
    apiClient,
    execSql,
    query: { documentId: DOCUMENT_ID },
  });

  expect(page.items.map((item) => item.updateId)).toEqual(["honest"]);
});

test("compact attribution is the API's while no update is void", async () => {
  const compact = {
    attributionRevision: 3,
    documentId: DOCUMENT_ID,
    segments: [],
  } as DocumentEditAttributionResponse;
  const { apiClient, requests } = api([], compact);

  expect(
    await loadReaderDocumentEditAttribution({
      apiClient,
      documentId: DOCUMENT_ID,
      execSql,
    }),
  ).toBe(compact);
  expect(requests).toEqual([]);
});

test("compact attribution credits no void update and merges as the API does", async () => {
  await recordVoid({ updateId: "void" });
  const { apiClient, requests } = api([
    [range("a", "1", 0, 5, "bob"), range("b", "1", 5, 8, "bob")],
    [
      range("void", "1", 8, 12, "mallory"),
      range("c", "1", 12, 20, "bob"),
      range("d", "2", 0, 4, "carol"),
    ],
  ]);

  const attribution = await loadReaderDocumentEditAttribution({
    apiClient,
    documentId: DOCUMENT_ID,
    execSql,
  });

  expect(attribution).toMatchObject({
    attributionRevision: 7,
    documentId: DOCUMENT_ID,
    truncated: false,
  });
  expect(
    attribution?.segments.map((segment) => [
      segment.peerId,
      segment.startCounter,
      segment.endCounter,
      segment.writerUserId,
    ]),
  ).toEqual([
    ["1", 0, 8, "bob"],
    ["1", 12, 20, "bob"],
    ["2", 0, 4, "carol"],
  ]);
  // Every page after the first is bound to the first page's revision.
  expect(requests.map((request) => request.expectedRevision)).toEqual([
    undefined,
    7,
  ]);
});

test("compact attribution built from ranges truncates where the API does", async () => {
  await recordVoid({ updateId: "void" });
  const many = Array.from({ length: 2_001 }, (_, index) =>
    range(`u${index}`, "1", index * 2, index * 2 + 1, "bob"),
  );
  const { apiClient } = api([[...many, range("void", "2", 0, 1, "mallory")]]);

  const attribution = await loadReaderDocumentEditAttribution({
    apiClient,
    documentId: DOCUMENT_ID,
    execSql,
  });

  expect(attribution?.truncated).toBe(true);
  expect(attribution?.segments).toHaveLength(2_000);
});
