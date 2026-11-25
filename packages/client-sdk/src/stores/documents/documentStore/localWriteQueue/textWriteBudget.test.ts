import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import { defaultDocumentsPersistence } from "../../../../workflows/documents";
import { createDocumentStore } from "../index";
import {
  ensureDeferredBirthSchema,
  offlineAttachRuntime,
} from "../initialization/deferredInitialUpdate.testFixtures";

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

// Loro's unbounded character diff took about 8 s for this replacement.
const REPLACEMENT_LIMIT_MS = 2000;

test("replacing a note's whole text with unrelated text does not stall the writer", async () => {
  const { close, execSql } = await createTestExecSql("text-write-budget");
  const logs: string[] = [];
  const open = () => {
    const runtime = offlineAttachRuntime({
      blobStore: createMemoryBlobStore(),
      canAttach: false,
      execSql,
    });
    return createDocumentStore(
      "text-write-budget",
      {
        ...runtime,
        util: {
          ...runtime.util,
          log: (message: string) => {
            logs.push(message);
            // A host logger that throws must not cost the write its save.
            throw new Error("host logger failed");
          },
        },
      },
      defaultDocumentsPersistence,
      null,
      "",
      "note",
    );
  };
  try {
    await ensureDeferredBirthSchema(execSql);
    const store = open();
    expect(await store.ensureInitialized()).toBe(true);
    await store.setText(prose(65536, 1));
    const replacement = prose(65536, 99);

    const started = performance.now();
    await store.setText(replacement);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(REPLACEMENT_LIMIT_MS);
    // The character diff ran out of time, and the store said so once.
    expect(logs).toEqual([
      expect.stringMatching(
        /^Documents: wrote the text of text-write-budget as a (line|whole) replacement/u,
      ),
    ]);
    expect(store.getSnapshot().text).toBe(replacement);
    const reopened = open();
    expect(await reopened.ensureInitialized()).toBe(true);
    expect(reopened.getSnapshot().text).toBe(replacement);
  } finally {
    close();
  }
});
