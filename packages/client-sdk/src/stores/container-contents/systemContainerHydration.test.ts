import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@symcrypt/crypto";
import type { ContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import { probeExistingSystemContainer } from "./systemContainerHydration";
import type { ContainerContentsStoreState } from "./types";

test("system container probing propagates identity failures without a local fallback", async () => {
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted identity changed",
  );
  const logs: string[] = [];

  await expect(
    probeExistingSystemContainer({
      logLabel: "Container contents",
      rootState: null,
      state: {
        runtime: { util: { log: (message: string) => logs.push(message) } },
      } as unknown as ContainerContentsStoreState,
      syncAgent: {
        requestRemoteHydration: async () => {
          throw integrityError;
        },
      } as never,
      systemSlot:
        "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as ContainerSystemSlot,
    }),
  ).rejects.toBe(integrityError);
  expect(logs).toEqual([]);
});
