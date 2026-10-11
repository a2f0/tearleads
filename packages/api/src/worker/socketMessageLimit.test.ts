import { expect, test } from "bun:test";
import { MAX_WS_CLIENT_MESSAGE_BYTES } from "@tearleads/validators/realtime";
import { exceedsClientMessageLimit } from "./socketMessageLimit";

test("an ASCII frame at the ceiling is accepted and one byte over is refused", () => {
  expect(
    exceedsClientMessageLimit("a".repeat(MAX_WS_CLIENT_MESSAGE_BYTES)),
  ).toBe(false);
  expect(
    exceedsClientMessageLimit("a".repeat(MAX_WS_CLIENT_MESSAGE_BYTES + 1)),
  ).toBe(true);
});

test("a multibyte frame is measured in UTF-8 bytes, not UTF-16 units", () => {
  // Three bytes each in UTF-8, one UTF-16 unit each.
  const units = Math.ceil(MAX_WS_CLIENT_MESSAGE_BYTES / 3) + 1;
  const frame = "€".repeat(units);
  expect(frame.length).toBeLessThanOrEqual(MAX_WS_CLIENT_MESSAGE_BYTES);
  expect(exceedsClientMessageLimit(frame)).toBe(true);
});
