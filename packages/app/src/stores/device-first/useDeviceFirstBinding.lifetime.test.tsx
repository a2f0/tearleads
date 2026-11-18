import { expect, spyOn, test } from "bun:test";
import { Tearleads } from "@tearleads/client-sdk";
import { act, renderHook } from "@testing-library/react";
import * as sdkProvider from "../../providers/sdk/TearleadsProvider";
import { useDeviceFirstBinding } from "./useDeviceFirstBinding";

test("a mounted binding reopens the tree when the same scope is disposed", async () => {
  const sdk = new Tearleads({ online: false });
  const source = spyOn(sdkProvider, "useTearleads").mockReturnValue(sdk);
  const runtime = sdk.containerContents.workflowRuntime();
  const view = renderHook(() =>
    useDeviceFirstBinding({ events: [], logLabel: "test", runtime }),
  );
  try {
    for (let turn = 0; turn < 2; turn++) {
      const previous = view.result.current;
      await act(async () => sdk.dispose());
      expect(view.result.current).not.toBe(previous);
      expect(view.result.current).toBe(sdk.deviceFirst.open());
    }
  } finally {
    view.unmount();
    source.mockRestore();
    sdk.dispose();
  }
});
