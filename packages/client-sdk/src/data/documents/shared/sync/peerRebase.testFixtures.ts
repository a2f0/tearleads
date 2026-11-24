import { createDocument, LoroList, LoroMap } from "@tearleads/loro";

export type TestDocument = Awaited<ReturnType<typeof createDocument>>;

/** Deterministic PRNG (mulberry32), so a failing seed replays exactly. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export async function documentOnPeer(peer: number): Promise<TestDocument> {
  const doc = await createDocument(`peer-rebase-test:${peer}`);
  doc.setPeerId(BigInt(peer));
  return doc;
}

export function versionCounters(doc: TestDocument): Map<string, number> {
  return new Map(doc.oplogVersion().toJSON());
}

/** JSON with object keys sorted, so equal content compares equal. */
export function canonicalContent(doc: TestDocument): string {
  return JSON.stringify(
    { json: doc.toJSON(), text: doc.getText("text").toDelta() },
    (_key, nested: unknown) =>
      nested !== null && typeof nested === "object" && !Array.isArray(nested)
        ? Object.fromEntries(
            Object.entries(nested).sort(([left], [right]) =>
              left < right ? -1 : left > right ? 1 : 0,
            ),
          )
        : nested,
  );
}

function pick<T>(random: () => number, values: readonly T[]): T {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) throw new Error("pick from an empty list");
  return value;
}

function randomIndex(random: () => number, length: number): number {
  return Math.floor(random() * (length + 1));
}

function editText(doc: TestDocument, random: () => number): void {
  const text = doc.getText("text");
  const length = text.length;
  const action = random();
  if (length > 2 && action < 0.25) {
    const start = Math.floor(random() * (length - 1));
    text.delete(start, 1 + Math.floor(random() * Math.min(3, length - start)));
  } else if (length > 2 && action < 0.5) {
    const start = Math.floor(random() * (length - 1));
    const end = start + 1 + Math.floor(random() * (length - start - 1));
    text.mark({ end, start }, pick(random, ["bold", "italic"]), random() < 0.8);
  } else {
    text.insert(randomIndex(random, length), pick(random, ["a", "bc", "def"]));
  }
}

function editFields(doc: TestDocument, random: () => number): void {
  const fields = doc.getMap("fields");
  const key = pick(random, ["title", "kind", "owner", "due"]);
  if (random() < 0.3) fields.delete(key);
  else fields.set(key, random() < 0.5 ? Math.floor(random() * 100) : key);
}

function rowAt(rows: LoroList, index: number): LoroMap | null {
  const row = rows.get(index);
  return row instanceof LoroMap ? row : null;
}

function insertRow(rows: LoroList, random: () => number): void {
  const row = rows.insertContainer(
    randomIndex(random, rows.length),
    new LoroMap(),
  );
  row.set("name", pick(random, ["x", "y", "z"]));
  const tags = row.setContainer("tags", new LoroList());
  tags.push(pick(random, ["t1", "t2"]));
  const meta = row.setContainer("meta", new LoroMap());
  meta.set("weight", Math.floor(random() * 10));
}

function editRows(doc: TestDocument, random: () => number): void {
  const rows = doc.getList("rows");
  const row =
    rows.length > 0 ? rowAt(rows, Math.floor(random() * rows.length)) : null;
  const action = random();
  if (!row || action < 0.35) {
    insertRow(rows, random);
  } else if (action < 0.5) {
    rows.delete(Math.floor(random() * rows.length), 1);
  } else if (action < 0.7) {
    row.set("name", pick(random, ["p", "q"]));
  } else {
    const nested = row.get("tags");
    if (nested instanceof LoroList) {
      nested.insert(randomIndex(random, nested.length), "t3");
    }
    const meta = row.get("meta");
    if (meta instanceof LoroMap) meta.set("weight", Math.floor(random() * 10));
  }
}

/** One to three random edits across text with marks, fields, and rows. */
export function randomEdits(doc: TestDocument, random: () => number): void {
  const count = 1 + Math.floor(random() * 3);
  for (let index = 0; index < count; index += 1) {
    const area = random();
    if (area < 0.4) editText(doc, random);
    else if (area < 0.6) editFields(doc, random);
    else editRows(doc, random);
  }
  doc.commit();
}

/** Every change `version` holds, flattened. */
function keptChanges(doc: TestDocument, version: ReadonlyMap<string, number>) {
  return [...doc.getAllChanges()].flatMap(([peer, changes]) =>
    changes.filter((change) => change.counter < (version.get(peer) ?? 0)),
  );
}

/** Raise `version` until every operation it holds has its dependencies. */
export function closeUpward(
  doc: TestDocument,
  version: Map<string, number>,
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const dependency of keptChanges(doc, version).flatMap(
      (change) => change.deps,
    )) {
      if (dependency.counter + 1 > (version.get(dependency.peer) ?? 0)) {
        version.set(dependency.peer, dependency.counter + 1);
        changed = true;
      }
    }
  }
}

/** Whether every kept change's dependencies are kept too. */
export function isCausallyClosed(
  doc: TestDocument,
  version: ReadonlyMap<string, number>,
): boolean {
  for (const [peer, changes] of doc.getAllChanges()) {
    for (const change of changes) {
      if (change.counter >= (version.get(peer) ?? 0)) continue;
      for (const dependency of change.deps) {
        if (dependency.counter >= (version.get(dependency.peer) ?? 0)) {
          return false;
        }
      }
    }
  }
  return true;
}

export function covers(
  version: ReadonlyMap<string, number>,
  required: ReadonlyMap<string, number>,
): boolean {
  for (const [peer, counter] of required) {
    if ((version.get(peer) ?? 0) < counter) return false;
  }
  return true;
}
