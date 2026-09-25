import { expect, mock, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createDomainScope } from "../../data/domainScope";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { observeContainerBackgroundHydration } from "./backgroundHydration";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import { createContainerContentsStoreState } from "./state";

function createState() {
  return createContainerContentsStoreState(
    createContainerContentsTestRuntime({
      domainScope: createDomainScope(),
      execSql: mock(async () => []),
    }),
    defaultContainerContentsPersistence,
  );
}

test.each(["throw", "reject"] as const)(
  "background observation preserves refusal when diagnostics %s",
  async (mode) => {
    const state = createState();
    const failure = new KeyingVerificationError("unauthorized", "refused");
    const reportSecurityIncident = mock(async () => {
      throw new Error("incident persistence unavailable");
    });
    const logError = mock(() => {
      const loggerFailure = new Error("logger unavailable");
      if (mode === "throw") throw loggerFailure;
      return Promise.reject(loggerFailure);
    });
    state.runtime = {
      ...state.runtime,
      util: { ...state.runtime.util, reportSecurityIncident, logError },
    };
    const hydration = Promise.reject(failure);
    observeContainerBackgroundHydration(state, hydration);
    await expect(hydration).rejects.toBe(failure);
    await Bun.sleep(0);
    expect(reportSecurityIncident).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      "Container background hydration failed",
      failure,
    );
  },
);

test("an old hydration refusal cannot report into a replacement generation", async () => {
  const state = createState();
  const reportSecurityIncident = mock(async () => {});
  const logError = mock(() => {});
  state.runtime = {
    ...state.runtime,
    util: { ...state.runtime.util, reportSecurityIncident, logError },
  };
  const hydration = Promise.reject(
    new KeyingVerificationError("unauthorized", "old refusal"),
  );
  observeContainerBackgroundHydration(state, hydration);
  state.lifecycleGeneration += 1;
  await Bun.sleep(0);
  expect(reportSecurityIncident).not.toHaveBeenCalled();
  expect(logError).not.toHaveBeenCalled();
});
