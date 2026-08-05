import { expect, test } from "bun:test";
import { requiredLicensedSeatCount } from "./organizationSeatCapacity";

function billing(input: {
  readonly seatCount?: number;
  readonly status?: "active" | "trialing";
}) {
  return {
    seatCount: input.seatCount ?? 1,
    status: input.status ?? ("active" as const),
  };
}

test("a trial grants ten sync seats regardless of roster size", () => {
  expect(requiredLicensedSeatCount(billing({ status: "trialing" }))).toBe(10);
  expect(requiredLicensedSeatCount(billing({ status: "trialing" }))).toBe(10);
  expect(requiredLicensedSeatCount(billing({ status: "trialing" }))).toBe(10);
});

test("an active subscription keeps its purchased capacity", () => {
  expect(requiredLicensedSeatCount(billing({ seatCount: 1 }))).toBe(1);
  expect(requiredLicensedSeatCount(billing({ seatCount: 5 }))).toBe(5);
  expect(requiredLicensedSeatCount(billing({ seatCount: 10 }))).toBe(10);
});
