import { afterEach, expect, test } from "bun:test";
import { Tearleads } from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useMemo } from "react";
import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import { documentsAuthorityGeneration } from "../documents/documentsAuthority";
import { createSelfContactIdentitySource } from "./createSelfContactIdentitySource";
import { useSelfContactIdentitySource } from "./useSelfContactIdentitySource";

afterEach(cleanup);

test("note autosaves update the real projection without reloading self identity", async () => {
  const runtime = await createSqlRuntimeBase("identity-autosave");
  const sdk = new Tearleads({
    database: { execSql: runtime.infra.execSql, id: "identity-autosave" },
    blobStore: runtime.infra.blobStore,
    identity: { signingFingerprint: "identity-autosave" },
    identityProvisioning: "manual",
    logger: { log: () => undefined, logError: () => undefined },
    online: false,
  });
  const containerId = "identity-unrelated-notes";
  const note = sdk.documents.open({
    containerId,
    localId: "unrelated-note",
    initialText: "Before autosave",
  });
  const { view } = sdk.deviceFirst.open();
  const title = () =>
    view.getSnapshot().documentSummariesByContainerId.get(containerId)?.[0]
      ?.title;
  let unmount: () => void = () => undefined;
  const stops: Array<() => void> = [];
  try {
    expect(await note.ensureInitialized()).toBe(true);
    view.setActiveContainer(containerId);
    await waitFor(() => expect(title()).toBe("Before autosave"));
    const original = createSelfContactIdentitySource(
      sdk,
      view,
      documentsAuthorityGeneration(sdk),
    );
    let loads = 0;
    const source = {
      ...original,
      load: () => {
        loads += 1;
        return original.load();
      },
    };
    let memoRuns = 0;
    const hook = renderHook(() => {
      const identity = useSelfContactIdentitySource(source);
      useMemo(() => {
        memoRuns += 1;
        return identity;
      }, [identity]);
      return identity;
    });
    unmount = hook.unmount;
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    const initialLoads = loads;
    const initialMemoRuns = memoRuns;
    const initialView = hook.result.current;
    let projections = 0;
    const placements: boolean[] = [];
    stops.push(view.subscribe(() => projections++));
    stops.push(
      sdk.documents.subscribe((summary, change) => {
        if (summary.id === "unrelated-note")
          placements.push(change.placementChanged);
      }),
    );
    for (const text of ["First autosave", "Second autosave"]) {
      const projected = Promise.withResolvers<void>();
      const stop = view.subscribe(() => {
        if (title() === text) projected.resolve();
      });
      try {
        await act(async () => {
          await note.setText(text);
          await projected.promise;
        });
      } finally {
        stop();
      }
    }
    expect(placements).toEqual([false, false]);
    expect(projections).toBeGreaterThanOrEqual(2);
    expect(loads).toBe(initialLoads);
    expect(hook.result.current).toBe(initialView);
    expect(memoRuns).toBe(initialMemoRuns);
  } finally {
    unmount();
    for (const stop of stops) stop();
    sdk.dispose();
    runtime.close();
  }
});
