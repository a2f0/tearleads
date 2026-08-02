import { expect, test } from "bun:test";
import {
  isContainerKekKeyringWireRecord,
  MAX_CONTAINER_KEY_EPOCH,
  MAX_SEALED_CONTAINER_KEK_KEYRING_BASE64_LENGTH,
  sealedContainerKekKeyringBytes,
} from "./containerKekKeyringWire";

function keyringRecord(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    sealingSuite: "tearleads.container-kek-keyring.aes-256-gcm-current-kek",
    containerId: "container-1",
    containerKeyEpochId: "tearleads.container-kek.v1.sha256:ab",
    iv: "A".repeat(16),
    sealed: "A".repeat(120),
    ...overrides,
  };
}

test("the sealed length equation is exact per epoch", () => {
  expect(sealedContainerKekKeyringBytes(2)).toBe(8 + 64 + 16);
  expect(sealedContainerKekKeyringBytes(5)).toBe(8 + 4 * 64 + 16);
  expect(MAX_SEALED_CONTAINER_KEK_KEYRING_BASE64_LENGTH).toBe(
    Math.ceil(sealedContainerKekKeyringBytes(MAX_CONTAINER_KEY_EPOCH) / 3) * 4,
  );
});

test("the wire guard accepts a structurally sound keyring record", () => {
  expect(isContainerKekKeyringWireRecord(keyringRecord())).toBe(true);
});

test("the parse ceiling rejects an oversized sealed blob before crypto", () => {
  expect(
    isContainerKekKeyringWireRecord(
      keyringRecord({
        sealed: "A".repeat(MAX_SEALED_CONTAINER_KEK_KEYRING_BASE64_LENGTH + 4),
      }),
    ),
  ).toBe(false);
  expect(
    isContainerKekKeyringWireRecord(keyringRecord({ iv: "A".repeat(64) })),
  ).toBe(false);
});

test("the wire guard rejects malformed records", () => {
  expect(isContainerKekKeyringWireRecord(null)).toBe(false);
  expect(isContainerKekKeyringWireRecord([])).toBe(false);
  expect(isContainerKekKeyringWireRecord(keyringRecord({ version: 2 }))).toBe(
    false,
  );
  expect(isContainerKekKeyringWireRecord(keyringRecord({ sealed: 7 }))).toBe(
    false,
  );
  const missingIv = keyringRecord();
  Reflect.deleteProperty(missingIv, "iv");
  expect(isContainerKekKeyringWireRecord(missingIv)).toBe(false);
});
