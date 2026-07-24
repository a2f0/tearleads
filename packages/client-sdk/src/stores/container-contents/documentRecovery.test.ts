import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "../../workflows/container-contents/containerPersistence";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../../workflows/container-contents/runtime";
import { primeStoreDocuments } from "./documentRecovery";

test("a priming signal raised mid-pass survives for the next pass", async () => {
  const { close, execSql: baseExecSql } = await createTestExecSql(
    "document-recovery-priming-signal-race",
  );
  try {
    let signalQueryStarted = () => {};
    const queryStarted = new Promise<void>((resolve) => {
      signalQueryStarted = resolve;
    });
    let releaseSignalQuery = () => {};
    const signalQueryMayFinish = new Promise<void>((resolve) => {
      releaseSignalQuery = resolve;
    });
    let candidateQueryCount = 0;
    const execSql = (async (
      sql: string,
      bind?: Parameters<ExecSql>[1],
      options?: { rowMode?: "object" | "array" },
    ) => {
      if (sql.includes("SELECT pending.local_id AS local_id")) {
        candidateQueryCount += 1;
        if (candidateQueryCount === 1) {
          signalQueryStarted();
          await signalQueryMayFinish;
        }
      }
      return baseExecSql(sql, bind, options);
    }) as ExecSql;
    const state = {
      containersById: new Map<string, ContainerState>(),
      documentStoresNeedPriming: true,
      persistence:
        defaultContainerContentsPersistence as ContainerContentsPersistence,
      runtime: {
        infra: { execSql },
        state: { domainScope: {} },
        util: { log: () => {} },
      } as unknown as ContainerContentsWorkflowRuntime,
    };

    const firstPass = primeStoreDocuments(state);
    await queryStarted;
    expect(state.documentStoresNeedPriming).toBe(false);

    // A topology reconciliation lands while the first pass is awaiting SQL.
    state.documentStoresNeedPriming = true;
    releaseSignalQuery();
    await firstPass;

    expect(state.documentStoresNeedPriming).toBe(true);

    // Mirrors the structural lane's guard for the coalesced follow-up pass.
    if (state.documentStoresNeedPriming) {
      await primeStoreDocuments(state);
    }

    expect(candidateQueryCount).toBe(2);
    expect(state.documentStoresNeedPriming).toBe(false);
  } finally {
    close();
  }
});
