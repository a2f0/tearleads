import type { Tearleads } from "@tearleads/client-sdk";

export function captureContinuityScope(sdk: Tearleads) {
  const runtime = sdk.containerContents.workflowRuntime();
  const stillCurrent = () => runtime.liveHydrationStatus?.() !== "retired";
  function assertCurrent() {
    if (!stillCurrent())
      throw new Error("The Continuity writer scope changed.");
  }
  return { runtime, stillCurrent, assertCurrent };
}
