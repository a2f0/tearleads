import { expect, test } from "bun:test";
import { transitionPrimaryDocumentSave } from "./primaryDocumentSaveMachine";

test("saves exclude double starts, tag settlements and allow a failed save to retry", () => {
  const first = {};
  const next = {};
  const saving = transitionPrimaryDocumentSave(
    { status: "idle" },
    { type: "save", request: first },
  );
  expect(
    transitionPrimaryDocumentSave(saving, { type: "save", request: next }),
  ).toBe(saving);
  expect(
    transitionPrimaryDocumentSave(saving, { type: "saved", request: next }),
  ).toBe(saving);
  const failed = transitionPrimaryDocumentSave(saving, {
    type: "failed",
    request: first,
    error: "Refused",
  });
  expect(failed).toEqual({ status: "failed", error: "Refused" });
  const retry = transitionPrimaryDocumentSave(failed, {
    type: "save",
    request: next,
  });
  expect(
    transitionPrimaryDocumentSave(retry, { type: "saved", request: next }),
  ).toEqual({ status: "idle" });
});
