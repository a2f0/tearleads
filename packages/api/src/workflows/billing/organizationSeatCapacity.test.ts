import { expect, test } from "bun:test";
import {
  licensedSeatCountChangeEventType,
  requiredLicensedSeatCount,
} from "./organizationSeatCapacity";

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
  expect(requiredLicensedSeatCount(billing({ status: "trialing" }), 1)).toBe(
    10,
  );
  expect(requiredLicensedSeatCount(billing({ status: "trialing" }), 11)).toBe(
    10,
  );
});

test("an active subscription keeps its purchased capacity", () => {
  expect(requiredLicensedSeatCount(billing({ seatCount: 1 }), 9)).toBe(1);
  expect(requiredLicensedSeatCount(billing({ seatCount: 5 }), 1)).toBe(5);
  expect(requiredLicensedSeatCount(billing({ seatCount: 10 }), 1)).toBe(10);
});

test("an active zero-capacity row initializes to a fixed roster tier", () => {
  expect(requiredLicensedSeatCount(billing({ seatCount: 0 }), 0)).toBe(1);
  expect(requiredLicensedSeatCount(billing({ seatCount: 0 }), 2)).toBe(5);
  expect(requiredLicensedSeatCount(billing({ seatCount: 0 }), 9)).toBe(10);
  expect(requiredLicensedSeatCount(billing({ seatCount: 0 }), 11)).toBe(10);
});

test("licensed capacity changes retain their audit meaning", () => {
  expect(licensedSeatCountChangeEventType(0, 10)).toBe(
    "licensed_seat_count_initialized",
  );
  expect(licensedSeatCountChangeEventType(1, 5)).toBe(
    "licensed_seat_count_increased",
  );
  expect(licensedSeatCountChangeEventType(10, 5)).toBe(
    "licensed_seat_count_decreased",
  );
});
