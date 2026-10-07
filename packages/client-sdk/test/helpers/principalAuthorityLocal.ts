import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE } from "@tearleads/validators/response";
import { getClientSQLitePersistenceRuntime } from "../../src/data/sqlite/sqlitePersistenceRuntime";
import type { signedAuthorityRecoveryHistory } from "./principalAuthorityRecovery";

/** Real signed evidence and SQLite custody, with page transport kept in-process. */
export async function createLocalAuthorityRecoveryFixture(
  history: Pick<
    Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>,
    "directory" | "admin" | "group"
  >,
) {
  const sqlite = await createTestExecSql("local-principal-authority");
  const policies = new Map(
    [history.directory, history.admin, history.group].map((bundle) => [
      bundle.currentState.principalId,
      bundle,
    ]),
  );
  const requests: {
    principalId: string;
    afterVersion: number;
    count: number;
  }[] = [];
  const controls: { error: Error | null } = { error: null };
  const apiClient = createMockApiClient({
    getPrincipalPolicyPages: async function* (
      principalType,
      principalId,
      options = {},
    ) {
      if (controls.error) throw controls.error;
      const bundle = policies.get(principalId);
      if (!bundle || bundle.currentState.principalType !== principalType)
        throw new Error("Missing fixture policy");
      if (
        options.stateHash &&
        options.stateHash !== bundle.currentState.stateHash
      )
        throw new Error("Changed fixture head");
      let afterVersion =
        options.resume?.afterVersion ?? options.afterVersion ?? 0;
      while (true) {
        const previousStates = bundle.previousStates.slice(
          afterVersion,
          afterVersion + PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE,
        );
        const next = afterVersion + previousStates.length;
        const nextAfterVersion =
          next === bundle.currentState.version - 1 ? null : next;
        requests.push({
          principalId,
          afterVersion,
          count: previousStates.length,
        });
        yield {
          ok: true as const,
          data: structuredClone({
            ...bundle,
            previousStates,
            historyPage: { afterVersion, nextAfterVersion },
          }),
        };
        if (nextAfterVersion === null) return;
        afterVersion = nextAfterVersion;
      }
    },
  });
  return {
    controls,
    requests,
    policies,
    db: getClientSQLitePersistenceRuntime(sqlite.execSql).db,
    options: {
      apiClient,
      execSql: sqlite.execSql,
      protection: {
        context: "local-authority-recovery",
        localKey: new Uint8Array(32).fill(9),
      },
    },
    close: sqlite.close,
  };
}
