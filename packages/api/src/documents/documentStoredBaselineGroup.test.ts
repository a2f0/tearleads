import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import {
  documentUpdateSpans,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import { and, eq, inArray } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { baselineSegmentRanges } from "../../test/helpers/documentBaselineGroups";
import { insertStoredBaselineGroup } from "../../test/helpers/storedBaselineGroup";
import {
  findLatestWholeStoredBaselineGroup,
  loadLatestStoredDocumentBaselineGroup,
  MAX_LATEST_BASELINE_GROUP_CANDIDATES,
  readStoredBaselineGroupCoverage,
} from "./documentStoredBaselineGroup";
import { resolveBaselineRedirectAfterSequence } from "./documentSyncBaselineRedirect";

const COVERAGE = encodeVersionVectorCounters({ "7": 6 });

async function twoStoredGroups(segments: number) {
  const documentId = randomUUID();
  const ranges = baselineSegmentRanges(COVERAGE, segments);
  await insertStoredBaselineGroup({ contentKeyEpoch: 2, documentId, ranges });
  const latest = await insertStoredBaselineGroup({
    contentKeyEpoch: 2,
    documentId,
    ranges,
  });
  return { documentId, latest };
}

// A redirect starts a reader just before a baseline's first segment. A
// reader whose pull already starts there or later cannot be redirected by
// that group or an older one, so the redirect answers from the group's
// position, before it reads the spans that say what the group covers.
test("a reader already at or past the latest baseline is not redirected", async () => {
  const { documentId, latest } = await twoStoredGroups(3);
  expect(
    await findLatestWholeStoredBaselineGroup(db, {
      contentKeyEpoch: 2,
      documentId,
    }),
  ).toEqual({
    baselineId: latest.baselineId,
    coversThroughUpdateId: undefined,
    firstSequence: latest.firstSequence,
  });
  expect(
    await loadLatestStoredDocumentBaselineGroup(db, {
      contentKeyEpoch: 2,
      documentId,
    }),
  ).toMatchObject({ coverage: COVERAGE, firstSequence: latest.firstSequence });

  const redirect = async (afterSequence: number) => {
    const counter = { statements: 0 };
    const after = await withDatabaseStatementCounter(counter, () =>
      resolveBaselineRedirectAfterSequence({
        afterSequence,
        contentKeyEpoch: 2,
        documentId,
        executor: db,
        firstPage: true,
        localVersionVector: null,
        upperBoundSequence: latest.lastSequence,
      }),
    );
    return { after, statements: counter.statements };
  };
  // A reader that holds nothing is moved to just before the first segment.
  expect((await redirect(0)).after).toBe(latest.firstSequence - 1);
  // Starting just before the first segment is where a redirect would put
  // the reader; the older group, which starts earlier still, is not tried,
  // and one statement answers.
  for (const afterSequence of [latest.firstSequence - 1, latest.lastSequence]) {
    expect(await redirect(afterSequence)).toEqual({
      after: afterSequence,
      statements: 1,
    });
  }
});

// Finding the latest whole group and weighing what it covers are each one
// statement however many segments the group has: the first reads no payload
// and no vector, the second only spans.
test("a group of many segments is found and weighed by two statements", async () => {
  for (const segments of [2, 6]) {
    const { documentId, latest } = await twoStoredGroups(segments);
    expect(latest.updateIds).toHaveLength(segments);
    const counter = { statements: 0 };
    const group = await withDatabaseStatementCounter(counter, () =>
      loadLatestStoredDocumentBaselineGroup(db, {
        contentKeyEpoch: 2,
        documentId,
      }),
    );
    expect(group?.coverage).toBe(COVERAGE);
    expect(counter.statements).toBe(2);
  }
});

// The search looks at no more than a fixed number of sealed groups for a
// whole one. A document whose newest groups all lost a row is answered
// "none", and its reader is served everything, instead of the loader reading
// group after group.
test("the search for a whole baseline stops after a fixed number of groups", async () => {
  const documentId = randomUUID();
  const ranges = baselineSegmentRanges(COVERAGE, 2);
  const store = () =>
    insertStoredBaselineGroup({ contentKeyEpoch: 2, documentId, ranges });
  const whole = () =>
    findLatestWholeStoredBaselineGroup(db, { contentKeyEpoch: 2, documentId });
  const oldest = await store();
  const newer = [];
  for (
    let group = 0;
    group < MAX_LATEST_BASELINE_GROUP_CANDIDATES;
    group += 1
  ) {
    newer.push(await store());
  }
  expect((await whole())?.baselineId).toBe(newer.at(-1)?.baselineId);

  // All but the oldest of the newer groups lose their first segment: the
  // oldest of them is still whole and within reach.
  const [withinReach, ...broken] = newer;
  if (!withinReach) throw new Error("Expected a group");
  const firstSegments = (groups: readonly (typeof withinReach)[]) =>
    groups.flatMap((group) => group.updateIds.slice(0, 1));
  await db
    .delete(documentUpdates)
    .where(inArray(documentUpdates.id, firstSegments(broken)));
  expect((await whole())?.baselineId).toBe(withinReach.baselineId);

  // Once it is broken too, the whole group older than all of them is past
  // the bound, and the answer is none.
  await db
    .delete(documentUpdates)
    .where(inArray(documentUpdates.id, firstSegments([withinReach])));
  expect(await whole()).toBeNull();
  expect(oldest.updateIds).toHaveLength(2);
});

// A group may hold a million spans, and its coverage is read on a cold
// reader's first page. The statement gives one row a peer from one
// aggregate: nothing in it orders the group's spans.
test("a group's coverage is one aggregate a peer, with no sort of its spans", async () => {
  const documentId = randomUUID();
  const group = await insertStoredBaselineGroup({
    contentKeyEpoch: 2,
    documentId,
    ranges: baselineSegmentRanges(COVERAGE, 3),
  });
  const statements: string[] = [];
  const recording = new Proxy(db, {
    get(target, key, receiver) {
      if (key === "execute")
        return (query: Parameters<typeof db.execute>[0]) => {
          if (typeof query !== "string")
            statements.push(new PgDialect().sqlToQuery(query.getSQL()).sql);
          return target.execute(query);
        };
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const coverage = () =>
    readStoredBaselineGroupCoverage(recording, {
      baselineId: group.baselineId,
      documentId,
    });
  expect(await coverage()).toBe(COVERAGE);
  expect(statements).toHaveLength(1);
  const [statement] = statements;
  expect(statement).toContain("group by");
  for (const sorting of [" over ", "lag(", "order by", "row_number"]) {
    expect([sorting, statement?.includes(sorting)]).toEqual([sorting, false]);
  }

  // What the aggregate must still tell: a peer's spans that lost their
  // first or a middle one cover nothing, and ones that lost their last
  // cover what is left.
  const [first, middle, last] = group.updateIds;
  const spanOf = (updateId: string | undefined) =>
    and(
      eq(documentUpdateSpans.documentId, documentId),
      eq(documentUpdateSpans.updateId, updateId ?? ""),
    );
  const without = async (updateId: string | undefined) => {
    const rows = await db
      .delete(documentUpdateSpans)
      .where(spanOf(updateId))
      .returning();
    expect(rows).toHaveLength(1);
    const read = await coverage();
    await db.insert(documentUpdateSpans).values(rows);
    return read;
  };
  expect(await without(first)).toBeNull();
  expect(await without(middle)).toBeNull();
  expect(await without(last)).toBe(encodeVersionVectorCounters({ "7": 4 }));
  expect(await coverage()).toBe(COVERAGE);

  // Spans that add up to where they end and do not start at zero: no commit
  // stores such a run, and it covers nothing.
  const startAt = (updateId: string | undefined, startCounter: number) =>
    db
      .update(documentUpdateSpans)
      .set({ startCounter })
      .where(spanOf(updateId));
  await startAt(first, 1);
  await startAt(middle, 1);
  expect(await coverage()).toBeNull();
  await startAt(first, 0);
  await startAt(middle, 2);
  expect(await coverage()).toBe(COVERAGE);
});
