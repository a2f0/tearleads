import { test } from "bun:test";
import assert from "node:assert/strict";
import { isCompleted } from "./run-state";

test("exhausted grading is a completed measurement, not an infrastructure failure", () => {
  assert.equal(isCompleted("done", "finished"), true);
  assert.equal(isCompleted("done", "succeeded"), true);
  assert.equal(isCompleted("processing"), false);
});

test("execution failures never count as benchmark results", () => {
  assert.throws(() => isCompleted("done", "failed"), /Infrastructure/);
  assert.throws(() => isCompleted("done"), /missing outcome/);
  assert.throws(() => isCompleted("cancelled"), /cancelled/);
});
