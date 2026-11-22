import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import {
  isRemovedSlotDetachWaiting,
  planRemovedSlotDetach,
  type RemovedSlotDetachState,
  transitionRemovedSlotDetach,
} from "./removedSlotDetachMachine";

async function versions() {
  const doc = await createDocument("removed-slot-machine");
  doc.getText("t").insert(0, "a");
  doc.commit();
  const older = encodeVersionVector(doc);
  doc.getText("t").insert(1, "b");
  doc.commit();
  return { newer: encodeVersionVector(doc), older };
}

test("a slot is seen once recorded, refused per binding and version, and forgotten once settled", () => {
  const seen = transitionRemovedSlotDetach(undefined, { type: "recorded" });
  expect(seen).toEqual({ status: "seen" });
  expect(transitionRemovedSlotDetach(seen, { type: "recorded" })).toBe(seen);
  const refused = transitionRemovedSlotDetach(seen, {
    bindingId: "binding-1",
    type: "detachRefused",
    versionVector: "v1",
  });
  expect(refused).toEqual({
    bindingId: "binding-1",
    status: "refused",
    versionVector: "v1",
  });
  // Seen recorded again, the slot is owed nothing until it is removed anew.
  expect(transitionRemovedSlotDetach(refused, { type: "recorded" })).toEqual({
    status: "seen",
  });
  expect(transitionRemovedSlotDetach(refused, { type: "settled" })).toBe(
    undefined,
  );
});

test("a refused detach waits only for the same binding at the same version", async () => {
  const { newer, older } = await versions();
  const binding = { bindingId: "binding-1" };
  const refused: RemovedSlotDetachState = {
    bindingId: binding.bindingId,
    status: "refused",
    versionVector: older,
  };

  expect(planRemovedSlotDetach(refused, undefined, older)).toBe("settle");
  expect(planRemovedSlotDetach({ status: "seen" }, binding, older)).toBe(
    "detach",
  );
  expect(planRemovedSlotDetach(refused, binding, older)).toBe("wait");
  expect(isRemovedSlotDetachWaiting(refused, older)).toBe(true);
  expect(planRemovedSlotDetach(refused, binding, newer)).toBe("detach");
  expect(isRemovedSlotDetachWaiting(refused, newer)).toBe(false);
  expect(
    planRemovedSlotDetach(refused, { bindingId: "binding-2" }, older),
  ).toBe("detach");
});
