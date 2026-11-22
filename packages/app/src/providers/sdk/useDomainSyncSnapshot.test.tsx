import { expect, test } from "bun:test";
import {
  createDomainScope,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { act, renderHook } from "@testing-library/react";
import { useDomainSyncSnapshot } from "./useDomainSyncSnapshot";

test("a mounted sync panel observes the replacement coordinator's lanes", async () => {
  const scope = createDomainScope();
  const panel = renderHook(() => useDomainSyncSnapshot(scope));
  try {
    await act(async () => getOrCreateDomainSyncCoordinator(scope).dispose());
    await act(async () => {
      getOrCreateDomainSyncCoordinator(scope).registerLane("replacement", {
        run: async () => {},
      });
    });
    expect(
      panel.result.current.lanes.some((lane) => lane.key === "replacement"),
    ).toBe(true);
  } finally {
    panel.unmount();
    getOrCreateDomainSyncCoordinator(scope).dispose();
  }
});
