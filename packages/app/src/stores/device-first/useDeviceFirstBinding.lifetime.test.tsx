import { expect, spyOn, test } from "bun:test";
import {
  type ContainerNode,
  syncedContainerDocumentObjectSyncState,
  Tearleads,
} from "@tearleads/client-sdk";
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

test("a replacement reconciler receives the pending document event for its tree", async () => {
  const sdk = new Tearleads({ online: false });
  const source = spyOn(sdkProvider, "useTearleads").mockReturnValue(sdk);
  const runtime = sdk.containerContents.workflowRuntime();
  const root: ContainerNode = {
    kind: "container",
    id: "root",
    name: "/",
    parentId: null,
    organizationId: "org",
    syncState: syncedContainerDocumentObjectSyncState,
  };
  const events = [
    {
      id: "pending",
      type: "document_mutation_created",
      eventType: "document.unlink",
      containerIds: ["root"],
      documentId: "doc-1",
    },
  ];
  const owners: unknown[] = [];
  const open = sdk.deviceFirst.open.bind(sdk.deviceFirst);
  spyOn(sdk.deviceFirst, "open").mockImplementation((options) => {
    const result = open(options);
    const snapshot = { ...result.view.getSnapshot(), containers: [root] };
    spyOn(result.view, "getSnapshot").mockReturnValue(snapshot);
    spyOn(result.reconciler, "enqueueContainer").mockImplementation(() => {
      owners.push(result.reconciler);
    });
    return result;
  });
  const binding = renderHook(() =>
    useDeviceFirstBinding({ runtime, events, logLabel: "test" }),
  );
  try {
    const first = binding.result.current.reconciler;
    expect(owners).toEqual([first]);
    await act(async () => sdk.dispose());
    const second = binding.result.current.reconciler;
    expect(second).not.toBe(first);
    expect(owners).toEqual([first, second]);
  } finally {
    binding.unmount();
    source.mockRestore();
    sdk.dispose();
  }
});
