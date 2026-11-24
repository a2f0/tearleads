import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createLoroWindowBench,
  DOCUMENT_ID,
  SCOPE,
} from "../../../../test/helpers/workflows/loroWindowBench";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import {
  readRotationAvailability,
  writeRotationAvailabilityInTransaction,
} from "../../../data/persistence/documents/records/rotationAvailabilityPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  noteDocumentRotationDiverged,
  readDocumentRotationLeftOut,
} from "./rotationAvailability";

const bench = createLoroWindowBench();
let execSql: ExecSql;

beforeEach(async () => {
  execSql = await bench.open();
});

afterEach(() => bench.close());

const ROTATION = {
  documentId: DOCUMENT_ID,
  isCurrent: () => true,
  scope: SCOPE,
};

async function store(
  state: Parameters<typeof writeRotationAvailabilityInTransaction>[2],
) {
  await writeRotationAvailabilityInTransaction(
    getClientSQLitePersistenceRuntime(execSql).db,
    SCOPE,
    state,
    "2026-11-24T00:00:00.000Z",
  );
}

const stored = () =>
  readRotationAvailability(
    getClientSQLitePersistenceRuntime(execSql).db,
    SCOPE,
  );

// A rebuild that left out the update its deaths came to rest on, yet still
// differs from the live document, shows the device holds that update: the
// deaths were the rebuild's, and the device stops rotating the document.
test("a diverged rebuild leaving an update out makes rotation unavailable", async () => {
  const judged = { documentId: DOCUMENT_ID, judge: documentVerdictJudge() };
  await store({ ...judged, deaths: 3, leftOut: "alone", status: "leavingOut" });
  expect(await readDocumentRotationLeftOut({ ...ROTATION, execSql })).toEqual([
    "alone",
  ]);
  const logged: string[] = [];

  await noteDocumentRotationDiverged({
    ...ROTATION,
    execSql,
    leftOut: ["alone"],
    logError: (message) => {
      logged.push(String(message));
    },
  });

  expect(await stored()).toEqual({
    ...judged,
    deaths: 3,
    status: "unavailable",
  });
  expect(logged).toEqual([
    expect.stringContaining("leaves them to other members"),
  ]);
  expect(await readDocumentRotationLeftOut({ ...ROTATION, execSql })).toEqual(
    [],
  );
});

// A rebuild that left nothing out and still differs says nothing about the
// rotation's deaths.
test("a diverged rebuild leaving nothing out changes nothing", async () => {
  const dying = {
    deaths: 1,
    documentId: DOCUMENT_ID,
    judge: documentVerdictJudge(),
    status: "dying",
  } as const;
  await store(dying);
  const logged: string[] = [];

  await noteDocumentRotationDiverged({
    ...ROTATION,
    execSql,
    leftOut: ["alone"],
    logError: (message) => {
      logged.push(String(message));
    },
  });

  expect(await stored()).toEqual(dying);
  expect(logged).toEqual([]);
});

// A row this build cannot read stands for none, so it never keeps a device
// from rotating.
test("an unreadable availability row reads as available", async () => {
  for (const [status, deaths, leftOut] of [
    ["future", 3, null],
    ["unavailable", 0, null],
    ["unavailable", 1.5, null],
    ["leavingOut", 3, null],
    ["leftOut", 0, null],
    ["leavingOut", 0, "alone"],
  ] as const) {
    await execSql("DELETE FROM document_rotation_availability");
    await execSql(
      `INSERT INTO document_rotation_availability (app_kind, local_id,
         document_id, judge, status, deaths, left_out, changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '2026-11-24T00:00:00.000Z')`,
      [
        SCOPE.appKind,
        SCOPE.localId,
        DOCUMENT_ID,
        documentVerdictJudge(),
        status,
        deaths,
        leftOut,
      ],
    );
    expect(await stored()).toEqual({ status: "available" });
  }
});

// A rotation proven without its left-out update counts its deaths from
// zero, and keeps leaving the update out.
test("a left-out update with no deaths since reads back", async () => {
  const leftOut = {
    deaths: 0,
    documentId: DOCUMENT_ID,
    judge: documentVerdictJudge(),
    leftOut: "alone",
    status: "leftOut",
  } as const;
  await store(leftOut);
  expect(await stored()).toEqual(leftOut);
  expect(await readDocumentRotationLeftOut({ ...ROTATION, execSql })).toEqual([
    "alone",
  ]);
});
