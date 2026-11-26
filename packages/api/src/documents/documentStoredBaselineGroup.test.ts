import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@tearleads/api-shared/postgres";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import { baselineSegmentRanges } from "../../test/helpers/documentBaselineGroups";
import { insertStoredBaselineGroup } from "../../test/helpers/storedBaselineGroup";
import { loadLatestStoredDocumentBaselineGroup } from "./documentStoredBaselineGroup";

// A redirect starts a reader just before a baseline's first segment. A
// reader whose pull already starts there or later cannot be redirected by
// that group or an older one, so the loader answers before it hashes a row.
test("a reader already at or past the latest baseline is given none", async () => {
  const documentId = randomUUID();
  const ranges = baselineSegmentRanges(
    encodeVersionVectorCounters({ "7": 6 }),
    3,
  );
  await insertStoredBaselineGroup({ contentKeyEpoch: 2, documentId, ranges });
  const latest = await insertStoredBaselineGroup({
    contentKeyEpoch: 2,
    documentId,
    ranges,
  });
  const load = (startsAfterSequence?: number) =>
    loadLatestStoredDocumentBaselineGroup(db, {
      contentKeyEpoch: 2,
      documentId,
      startsAfterSequence,
    });

  expect((await load())?.firstSequence).toBe(latest.firstSequence);
  expect((await load(latest.firstSequence - 2))?.firstSequence).toBe(
    latest.firstSequence,
  );
  // Starting just before the first segment is where a redirect would put
  // the reader; the older group, which starts earlier still, is not tried.
  expect(await load(latest.firstSequence - 1)).toBeNull();
  expect(await load(latest.lastSequence)).toBeNull();
});
