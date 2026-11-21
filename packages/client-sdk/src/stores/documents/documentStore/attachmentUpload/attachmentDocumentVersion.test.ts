import { expect, test } from "bun:test";
import {
  MAX_CONSECUTIVE_DOCUMENT_CHANGED_PASSES,
  pendingAttachmentDocumentVersion,
  recordDocumentChangedRefusal,
  settleDocumentChangedPasses,
} from "./attachmentDocumentVersion";

type PassState = Parameters<typeof recordDocumentChangedRefusal>[0];

const first = { slotId: "first", storageKey: "first-bytes" };
const second = { slotId: "second", storageKey: "second-bytes" };

function refuseUntilExhausted(state: PassState, upload: typeof first) {
  const repulls = Array.from(
    { length: MAX_CONSECUTIVE_DOCUMENT_CHANGED_PASSES + 1 },
    () => recordDocumentChangedRefusal(state, upload),
  );
  expect(repulls).toEqual([
    ...Array.from(
      { length: MAX_CONSECUTIVE_DOCUMENT_CHANGED_PASSES },
      () => true,
    ),
    false,
  ]);
}

test("an upload that used up its re-pulls leaves another upload's budget whole", () => {
  const state: PassState = { pendingAttachments: [first, second] };
  refuseUntilExhausted(state, first);

  // The first upload's slot is removed; the second's first honest refusal
  // still pulls right away instead of waiting for a later signal.
  const afterRemoval: PassState = { ...state, pendingAttachments: [second] };
  expect(recordDocumentChangedRefusal(afterRemoval, second)).toBe(true);
  expect(afterRemoval.attachmentDocumentChangedPasses?.size).toBe(1);
});

test("uploads refused in the same passes each stop after their own budget", () => {
  const state: PassState = { pendingAttachments: [first, second] };
  const repulls = Array.from(
    { length: MAX_CONSECUTIVE_DOCUMENT_CHANGED_PASSES + 1 },
    () => [
      recordDocumentChangedRefusal(state, first),
      recordDocumentChangedRefusal(state, second),
    ],
  );

  expect(repulls.at(-1)).toEqual([false, false]);
  expect(repulls.slice(0, -1).flat().every(Boolean)).toBe(true);
});

test("an attempt that ends for another reason restores its upload's budget", () => {
  const state: PassState = { pendingAttachments: [first] };
  refuseUntilExhausted(state, first);

  settleDocumentChangedPasses(state, first);
  refuseUntilExhausted(state, first);
});

test("a refreshed version pulls in the pass before checking the slot again", async () => {
  const steps: string[] = [];
  let pullCompletes = true;
  const version = pendingAttachmentDocumentVersion({
    checkedVersion: "checked",
    matchingVersion: () => {
      steps.push("check");
      return "pulled";
    },
    pull: async () => {
      steps.push("pull");
      return pullCompletes;
    },
  });

  expect(await version({ refresh: false })).toBe("checked");
  expect(steps).toEqual([]);
  expect(await version({ refresh: true })).toBe("pulled");
  expect(steps).toEqual(["pull", "check"]);

  // An incomplete pull never reads the slot: the pass ends and re-arms.
  pullCompletes = false;
  expect(await version({ refresh: true })).toBeNull();
  expect(steps).toEqual(["pull", "check", "pull"]);
});
