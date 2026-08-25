import { expect, test } from "bun:test";
import {
  deriveOrganizationMetadataContainerSystemSlot,
  deriveOrganizationRosterProfileContainerSystemSlot,
  isContainerSystemSlot,
} from "./containerSystemSlot";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";

test("organization system slots retain their deterministic namespaces", async () => {
  expect(
    await deriveOrganizationRosterProfileContainerSystemSlot({
      organizationId: ORGANIZATION_ID,
    }),
  ).toBe("sys_v1_H9igqSJSUMomF4fC6IICQmDam2QC-Y-K_fmF_1ldkOE");
  expect(
    await deriveOrganizationMetadataContainerSystemSlot({
      organizationId: ORGANIZATION_ID,
    }),
  ).toBe("sys_v1_r5N-3AIAOxDJdAnlJ0YeRxx2Qi45Dy1vYThQno0Qryc");
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
