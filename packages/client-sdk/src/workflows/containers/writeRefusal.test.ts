import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { ContainerAuthorAccessError } from "../../data/containers/shared/authorAccess";
import {
  ContainerKekRepairInaccessibleError,
  ContainerKekRepairRequiredError,
} from "../../data/documents/shared/containerKekCurrency";
import { shouldRetryWithFreshProjection } from "../documents/syncFailureClassification";
import { classifyContainerWriteRefusal } from "./writeRefusal";

test("a host can tell a retryable repair from one it cannot perform", () => {
  expect(
    classifyContainerWriteRefusal(new ContainerKekRepairRequiredError("c-1")),
  ).toEqual({ kind: "repair-required", containerId: "c-1" });
  // The subclass must win: it is also a ContainerKekRepairRequiredError.
  expect(
    classifyContainerWriteRefusal(
      new ContainerKekRepairInaccessibleError("c-2"),
    ),
  ).toEqual({ kind: "repair-inaccessible", containerId: "c-2" });
  expect(
    classifyContainerWriteRefusal(new ContainerAuthorAccessError("denied")),
  ).toEqual({ kind: "unauthorized" });
});

test("classification survives a second copy of the SDK", () => {
  const foreign = Object.assign(new Error("from another bundle"), {
    containerId: "c-3",
    name: "ContainerKekRepairInaccessibleError",
  });
  expect(classifyContainerWriteRefusal(foreign)).toEqual({
    kind: "repair-inaccessible",
    containerId: "c-3",
  });
});

test("integrity failures are never reported as a repair to wait out", () => {
  expect(
    classifyContainerWriteRefusal(
      new KeyingVerificationError("rollback", "older than the checkpoint"),
    ),
  ).toBeNull();
  expect(classifyContainerWriteRefusal(new Error("anything else"))).toBeNull();
  expect(classifyContainerWriteRefusal(null)).toBeNull();
});

test("an inaccessible repair still earns the one refetch a stale path gets", () => {
  // A capable member may already have repaired the chain; the refetch is what
  // turns a parked write into a successful one without waiting for a hint.
  expect(
    shouldRetryWithFreshProjection(
      new ContainerKekRepairInaccessibleError("c-4"),
      () => false,
    ),
  ).toBe(true);
});
