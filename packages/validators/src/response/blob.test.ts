import { expect, test } from "bun:test";
import { isBlobUploadCapabilitiesResponse } from "./blob";

test("isBlobUploadCapabilitiesResponse", () => {
  expect(
    isBlobUploadCapabilitiesResponse({
      multipart: { durable: true, enabled: true },
    }),
  ).toBe(true);
  expect(
    isBlobUploadCapabilitiesResponse({
      multipart: { durable: false, enabled: false },
    }),
  ).toBe(true);
  expect(
    isBlobUploadCapabilitiesResponse({
      multipart: { durable: "yes", enabled: true },
    }),
  ).toBe(false);
});
