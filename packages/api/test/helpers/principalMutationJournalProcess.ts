import { Database } from "bun:sqlite";
import { fileURLToPath } from "node:url";
import { ApiClient } from "@tearleads/api-client";
import {
  type AuthoredPrincipalMutation,
  type PrincipalMutationJournalContext,
  recoverJournaledPrincipalMutation,
  submitJournaledPrincipalMutation,
} from "@tearleads/client-sdk";
import { base64ToBytes } from "@tearleads/encoding";
import type { CommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";

interface JournalProcessInput {
  readonly url: string;
  readonly token: string;
  readonly databasePath: string;
  readonly scope: PrincipalMutationJournalContext["scope"];
  readonly publicKey: string;
  readonly privateKey: string;
  readonly mutation?: AuthoredPrincipalMutation;
}

type JournalProcessMessage =
  | {
      readonly ok: true;
      readonly response: CommitOrganizationGroupPolicyResponse;
    }
  | { readonly ok: false; readonly error: string };

/** A native on-disk SQLite adapter proves process durability, not WASM/OPFS behavior. */
function journalExecSql(
  database: Database,
): PrincipalMutationJournalContext["execSql"] {
  return (async (sql, bind, options) => {
    const parameters = Array.isArray(bind)
      ? [...bind]
      : bind &&
        Object.fromEntries(
          Object.entries(bind).map(([key, value]) => [
            /^[$:@]/.test(key) ? key : `$${key}`,
            value,
          ]),
        );
    if (!parameters && /;\s*\S/.test(sql.trim().replace(/;\s*$/, ""))) {
      database.run(sql);
      return [];
    }
    const statement = database.query(sql);
    try {
      if (options?.rowMode === "array")
        return parameters
          ? statement.values(parameters as never)
          : statement.values();
      return parameters ? statement.all(parameters as never) : statement.all();
    } finally {
      statement.finalize();
    }
  }) as PrincipalMutationJournalContext["execSql"];
}

export function startPrincipalMutationJournalProcess(
  input: JournalProcessInput,
) {
  const completed =
    Promise.withResolvers<CommitOrganizationGroupPolicyResponse>();
  void completed.promise.catch(() => {});
  const child = Bun.spawn({
    cmd: [process.execPath, fileURLToPath(import.meta.url)],
    stdin: new Blob([JSON.stringify(input)]),
    stdout: "ignore",
    stderr: "inherit",
    ipc(message: JournalProcessMessage, child) {
      child.send("received");
      if (message.ok) completed.resolve(message.response);
      else completed.reject(new Error(message.error));
    },
    onExit(_child, code) {
      completed.reject(
        new Error(`Journal client exited before its result (${code})`),
      );
    },
  });
  const timer = setTimeout(() => {
    completed.reject(new Error("Journal client timed out"));
    child.kill("SIGKILL");
  }, 20_000);
  void child.exited.finally(() => clearTimeout(timer));
  return { child, completed: completed.promise };
}

async function sendResult(message: JournalProcessMessage): Promise<void> {
  await new Promise<void>((resolve) => {
    process.once("message", () => resolve());
    process.send?.(message);
  });
}

async function runJournalProcess() {
  const input = JSON.parse(await Bun.stdin.text()) as JournalProcessInput;
  const database = new Database(input.databasePath);
  database.run("PRAGMA synchronous = FULL");
  const api = new ApiClient(input.url);
  api.setAuthToken(input.token);
  const context: PrincipalMutationJournalContext = {
    scope: input.scope,
    signingKeyPair: {
      signingPublicKey: base64ToBytes(input.publicKey),
      signingPrivateKey: base64ToBytes(input.privateKey),
    },
    stillCurrent: () => true,
    execSql: journalExecSql(database),
    submit: (mutation) =>
      api.commitOrganizationGroupPolicyResult(
        input.scope.organizationId,
        mutation.groupId,
        mutation.request,
        { signal: AbortSignal.timeout(15_000), reportErrors: false },
      ),
  };
  try {
    if (input.mutation) {
      const result = await submitJournaledPrincipalMutation({
        ...context,
        mutation: input.mutation,
      });
      if (!result.ok) throw new Error("Journal submission refused");
      await sendResult({
        ok: true,
        response: result.data,
      } satisfies JournalProcessMessage);
    } else {
      const recovered = await recoverJournaledPrincipalMutation(context);
      if (!recovered)
        throw new Error("No durable mutation survived the process restart");
      await sendResult({
        ok: true,
        response: recovered.response,
      } satisfies JournalProcessMessage);
    }
  } finally {
    context.signingKeyPair.signingPrivateKey.fill(0);
    database.close();
  }
}

if (import.meta.main) {
  try {
    await runJournalProcess();
    process.disconnect?.();
  } catch (error) {
    await sendResult({
      ok: false,
      error: error instanceof Error ? error.message : "Journal client failed",
    } satisfies JournalProcessMessage);
    process.disconnect?.();
    process.exitCode = 1;
  }
}
