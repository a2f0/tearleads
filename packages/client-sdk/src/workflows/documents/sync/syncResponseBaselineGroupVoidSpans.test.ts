import { afterEach, beforeEach, expect, test } from "bun:test";
import { createDocument, importUpdates } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  acceptServedPage as accept,
  type BaselineFixtureDocument,
  operationCount,
  rangeExport,
  servedBaselineGroup,
  operationSpan as span,
} from "../../../../test/helpers/workflows/servedBaselineGroupPass";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

// A void segment excuses only what builds on it. A later segment of its
// group that cannot join the reader's history is void when every operation
// it lacks is one an unapplied segment declared, and is otherwise a segment
// served without the ones it builds on, which fails the pass.

let execSql: ExecSql;
let close: () => void;

beforeEach(async () => {
  ({ close, execSql } = await createTestExecSql(
    "sync-response-baseline-group-void-spans",
  ));
});

afterEach(() => close());

/** A writer of its own peer with `lines` edits, on top of `base` if given. */
async function writerOf(lines: number, base?: BaselineFixtureDocument) {
  const writer = await createDocument(crypto.randomUUID());
  if (base) importUpdates(writer, [base.export({ mode: "update" })]);
  for (let line = 0; line < lines; line += 1) {
    const text = writer.getText("text");
    text.insert(text.length, `line ${line}\n`);
    writer.commit();
  }
  return writer;
}

/** Every operation `writer` made itself, and none it imported. */
function own(writer: BaselineFixtureDocument): Uint8Array {
  return rangeExport(writer, span(writer, 0, operationCount(writer)));
}

/** `writer`'s own operations with ten left out before the last ten. */
function gapped(writer: BaselineFixtureDocument): Uint8Array {
  const end = operationCount(writer);
  return rangeExport(
    writer,
    span(writer, 0, end - 20),
    span(writer, end - 10, end),
  );
}

function ids(updates: readonly { readonly id: string }[]): string[] {
  return updates.map(({ id }) => id);
}

function voidIds(result: {
  readonly voidedUpdates: readonly { readonly updateId: string }[];
}): string[] {
  return result.voidedUpdates.map(({ updateId }) => updateId);
}

/**
 * The group [A, gapped B, C, D, E]: five writers, each segment one writer's
 * own operations. B's payload leaves a gap inside its range, so it is void
 * for every reader. D is written on top of C and signs a dependency on it,
 * and on nothing of B. E is written on top of B and signs a dependency on
 * it, so no reader takes it either.
 */
async function groupWithAVoidSegment() {
  const a = await writerOf(6);
  const b = await writerOf(8);
  const c = await writerOf(4);
  const d = await writerOf(3, c);
  const e = await writerOf(2, b);
  const group = await servedBaselineGroup(execSql, () => [
    own(a),
    gapped(b),
    own(c),
    own(d),
    own(e),
  ]);
  const [first, second, third, fourth, fifth] = group.segments;
  if (!first || !second || !third || !fourth || !fifth) {
    throw new Error("Expected five segments");
  }
  const holderOfFirst = async () => {
    const reader = await createDocument(crypto.randomUUID());
    importUpdates(reader, [own(a)]);
    return reader;
  };
  return { ...group, fifth, first, fourth, holderOfFirst, second, third };
}

test("served honestly, every reader voids the same segments of a group with a void one", async () => {
  const { fifth, first, fourth, holderOfFirst, pass, second, segments, third } =
    await groupWithAVoidSegment();
  const cold = await pass({
    reader: await createDocument("void-spans-cold-reader"),
    updates: segments,
  });
  expect(ids(cold.decryptedUpdates)).toEqual(ids([first, third, fourth]));
  expect(voidIds(cold)).toEqual(ids([second, fifth]));

  const warm = await pass({
    reader: await holderOfFirst(),
    updates: segments.slice(1),
    warm: true,
  });
  expect(ids(warm.decryptedUpdates)).toEqual(ids([third, fourth]));
  expect(voidIds(warm)).toEqual(ids([second, fifth]));

  // One segment a page, for a cold reader and for one that holds the first.
  for (const holds of [false, true]) {
    const reader = holds
      ? await holderOfFirst()
      : await createDocument("void-spans-paged-reader");
    const served = holds ? segments.slice(1) : segments;
    const accepted: string[] = [];
    const voided: string[] = [];
    let run: Awaited<ReturnType<typeof pass>>["baselineGroupRun"] = null;
    for (const [index, segment] of served.entries()) {
      const page = await pass({
        more: index < served.length - 1,
        reader,
        run,
        updates: [segment],
        warm: holds,
      });
      accept(reader, page);
      accepted.push(...ids(page.decryptedUpdates));
      voided.push(...voidIds(page));
      run = page.baselineGroupRun;
    }
    expect(accepted).toEqual(
      ids(holds ? [third, fourth] : [first, third, fourth]),
    );
    expect(voided).toEqual(ids([second, fifth]));
  }
});

// A server that withholds C from a reader holding A serves D without the
// segment it builds on. The void B ahead of D supplied nothing D needs, so
// that is the server's omission: recording D void would outlast the
// server's correction, and every honest reader takes D.
test("a void segment does not excuse a segment the server withheld", async () => {
  const { fifth, fourth, holderOfFirst, pass, refusal, second, third } =
    await groupWithAVoidSegment();
  expect(
    await refusal({
      reader: await holderOfFirst(),
      updates: [second, fourth, fifth],
      warm: true,
    }),
  ).toContain("served without the segments it builds on");

  // The same omission across a page boundary: the run carries what the void
  // segment declared, and the withheld one supplies none of it.
  const paged = await holderOfFirst();
  const firstPage = await pass({
    more: true,
    reader: paged,
    updates: [second],
    warm: true,
  });
  expect(voidIds(firstPage)).toEqual([second.id]);
  const run = firstPage.baselineGroupRun;
  expect(
    await refusal({ reader: paged, run, updates: [fourth, fifth] }),
  ).toContain("served without the segments it builds on");
  // What builds on the void segment is void on that later page all the same.
  const onlyFifth = await pass({ reader: paged, run, updates: [fifth] });
  expect(onlyFifth.decryptedUpdates).toEqual([]);
  expect(voidIds(onlyFifth)).toEqual([fifth.id]);
  // Served honestly, the next page joins.
  const secondPage = await pass({
    reader: paged,
    run,
    updates: [third, fourth, fifth],
  });
  expect(ids(secondPage.decryptedUpdates)).toEqual(ids([third, fourth]));
  expect(voidIds(secondPage)).toEqual([fifth.id]);
});

// A void segment declares a span of its writer's operations, not the
// writer's whole history. The group [A, B, C]: one writer's operations cut
// in two, and a second writer's built on A alone. B is void. A server that
// withholds A serves C without the operations of B's writer that C builds
// on, and they are the ones below B's span.
test("a void segment excuses no operation below the span it declared", async () => {
  const { pass, refusal, segments } = await servedBaselineGroup(
    execSql,
    (document) => {
      const end = operationCount(document);
      const cut = end - 20;
      const other = document.forkAt([
        { counter: cut - 1, peer: document.peerIdStr },
      ]);
      other.getText("text").insert(0, "built on the first half\n");
      other.commit();
      return [
        rangeExport(document, span(document, 0, cut)),
        rangeExport(document, span(document, cut, end)),
        own(other),
      ];
    },
  );
  const [first, second, third] = segments;
  if (!first || !second || !third) throw new Error("Expected three segments");
  // A reader with history of its own and none of the group's.
  const knownVoidIds = [second.id];
  const honest = await pass({
    knownVoidIds,
    reader: await writerOf(1),
    updates: segments,
    warm: true,
  });
  expect(ids(honest.decryptedUpdates)).toEqual(ids([first, third]));
  expect(voidIds(honest)).toEqual([second.id]);
  expect(
    await refusal({
      knownVoidIds,
      reader: await writerOf(1),
      updates: [second, third],
      warm: true,
    }),
  ).toContain("served without the segments it builds on");
});
