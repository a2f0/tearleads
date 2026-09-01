import { expect, test } from "bun:test";
import {
  deriveOrganizationMetadataContainerSystemSlot,
  deriveOrganizationRosterProfileContainerSystemSlot,
  formatContainerSystemSlot,
  isContainerSystemSlot,
} from "./containerSystemSlot";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";

test("organization system slots retain their deterministic namespaces", async () => {
  expect(
    await deriveOrganizationRosterProfileContainerSystemSlot({
      organizationId: ORGANIZATION_ID,
    }),
  ).toBe("sys_v1_JD38_d_o8HZoET2G7K6ga0Xop6qjTqT0h1w4fb2RK4c");
  expect(
    await deriveOrganizationMetadataContainerSystemSlot({
      organizationId: ORGANIZATION_ID,
    }),
  ).toBe("sys_v1_vPgWEmQY7pwEgVLirgGJ3M9J3esua5Yxs1t0F0kCB8o");
});

test("derived organization slots satisfy the wire schema", async () => {
  expect(
    isContainerSystemSlot(
      await deriveOrganizationRosterProfileContainerSystemSlot({
        organizationId: crypto.randomUUID(),
      }),
    ),
  ).toBe(true);
});

test("system slot formatting rejects non-SHA-256 digest lengths", () => {
  expect(() => formatContainerSystemSlot(new Uint8Array(31))).toThrow(
    "exactly 32 bytes",
  );
  expect(() => formatContainerSystemSlot(new Uint8Array(33))).toThrow(
    "exactly 32 bytes",
  );
});
