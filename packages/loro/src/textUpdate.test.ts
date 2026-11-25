import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  exportUpdatesSince,
  importUpdates,
} from "./document";
import {
  TEXT_DIFF_BUDGET_MS,
  type TextUpdateOptions,
  updateText,
} from "./textUpdate";

type Document = Awaited<ReturnType<typeof createDocument>>;

const WORDS = [
  "the",
  "quick",
  "brown",
  "fox",
  "jumps",
  "over",
  "lazy",
  "dog\n",
];

/** `length` characters of prose; two seeds share almost nothing. */
function prose(length: number, seed: number): string {
  let text = "";
  let state = seed;
  while (text.length < length) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    // The generator's low bits repeat every few steps: take high ones.
    text += `${WORDS[(state >>> 16) % WORDS.length]} `;
  }
  return text.slice(0, length);
}

/** `count` short lines, none shared between two prefixes. */
function shortLines(count: number, prefix: string): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(
    "\n",
  );
}

async function documentHolding(seed: string, text: string): Promise<Document> {
  const doc = await createDocument(seed);
  doc.getText("text").insert(0, text);
  doc.commit();
  return doc;
}

/**
 * Writes `value` into a document holding `held` while another peer inserts
 * " REMOTE" into its first line, and returns how the write was expressed and
 * the merged text.
 */
async function writeDuringRemoteEdit(
  name: string,
  held: string,
  value: string,
  budgets: TextUpdateOptions | undefined,
) {
  const writer = await documentHolding(`${name}-writer`, held);
  const remote = await createDocument(`${name}-remote`);
  importUpdates(remote, [exportAllUpdates(writer)]);
  const before = encodeVersionVector(remote);
  remote.getText("text").insert(4, " REMOTE");
  remote.commit();

  const granularity = updateText(writer, value, budgets);
  writer.commit();
  importUpdates(writer, [exportUpdatesSince(remote, before)]);
  const merged = writer.getText("text").toString();
  writer.free();
  remote.free();
  return { granularity, merged };
}

test("an ordinary edit is a character diff, and merges inside the line it shares", async () => {
  const { granularity, merged } = await writeDuringRemoteEdit(
    "character",
    "keep me\nline two\n",
    "keep me\nline two edited\n",
    undefined,
  );

  expect(granularity).toBe("character");
  expect(merged).toBe("keep REMOTE me\nline two edited\n");
});

test("a rewrite the character diff cannot finish in its budget is a line diff, and merges inside a line it kept", async () => {
  const { granularity, merged } = await writeDuringRemoteEdit(
    "line",
    `keep me\n${prose(65536, 1)}`,
    `keep me\n${prose(65536, 99)}`,
    { characterBudgetMs: 5, lineBudgetMs: 60_000 },
  );

  expect(granularity).toBe("line");
  expect(merged).toBe(`keep REMOTE me\n${prose(65536, 99)}`);
});

test("a rewrite neither diff can finish replaces the whole text, and a concurrent insert survives without its line", async () => {
  const value = `keep me\n${shortLines(20_000, "b")}`;
  const { granularity, merged } = await writeDuringRemoteEdit(
    "whole",
    `keep me\n${shortLines(20_000, "a")}`,
    value,
    { characterBudgetMs: 5, lineBudgetMs: 5 },
  );

  expect(granularity).toBe("whole");
  expect(merged).toContain(" REMOTE");
  expect(merged.replace(" REMOTE", "")).toBe(value);
  expect(merged).not.toContain("keep REMOTE me");
});

// The budget runs out at once, and again after the diff has done real work.
test.each([5, 300])(
  "a diff that runs out of a %d ms budget leaves the document as it was",
  async (budgetMs) => {
    const held = prose(65536, 1);
    const doc = await documentHolding(`untouched-${budgetMs}`, held);
    const before = encodeVersionVector(doc);

    expect(() =>
      doc.getText("text").update(prose(65536, 99), { timeoutMs: budgetMs }),
    ).toThrow(new Error("Update timeout"));
    expect(doc.getText("text").toString()).toBe(held);
    doc.commit();

    expect(doc.getText("text").toString()).toBe(held);
    expect(encodeVersionVector(doc)).toBe(before);
    doc.free();
  },
);

test("the line diff that runs out of its budget leaves the document as it was", async () => {
  const held = shortLines(20_000, "a");
  const doc = await documentHolding("untouched-lines", held);
  const before = encodeVersionVector(doc);

  expect(() =>
    doc.getText("text").updateByLine(shortLines(20_000, "b"), { timeoutMs: 5 }),
  ).toThrow(new Error("Update timeout"));
  doc.commit();

  expect(doc.getText("text").toString()).toBe(held);
  expect(encodeVersionVector(doc)).toBe(before);
  doc.free();
});

test("replacing a note with unrelated text stays near the diff budgets", async () => {
  const value = prose(65536, 99);
  const doc = await documentHolding("bounded", prose(65536, 1));

  const started = performance.now();
  const granularity = updateText(doc, value);
  const elapsed = performance.now() - started;
  doc.commit();

  // The unbounded character diff took about 8 s here.
  expect(granularity).not.toBe("character");
  expect(doc.getText("text").toString()).toBe(value);
  expect(elapsed).toBeLessThan(TEXT_DIFF_BUDGET_MS * 2 + 1000);
  doc.free();
});

test("another failure of the write is thrown, not retried more coarsely", async () => {
  const doc = await documentHolding("detached", "held");
  doc.detach();

  // Loro refuses a write into a detached document; that is not a timeout.
  expect(() => updateText(doc, "changed")).toThrow(/detached/iu);
  expect(doc.getText("text").toString()).toBe("held");
  doc.free();
});
