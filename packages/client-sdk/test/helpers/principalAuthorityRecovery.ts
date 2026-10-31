import { ApiClient } from "@tearleads/api-client";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicyPageResponse,
} from "@tearleads/validators/response";
import { getClientSQLitePersistenceRuntime } from "../../src/data/sqlite/sqlitePersistenceRuntime";
import {
  organizationHistoryFixtureFrom,
  signOrganizationHistory,
} from "./organizationPolicyHistory";
import {
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "./principalPolicyFixtures";

// Signing three 66-version histories can exceed Bun's 5s hook default under CI load.
export const AUTHORITY_RECOVERY_SETUP_TIMEOUT_MS = 30_000;

const RECOVERY_HISTORY_VERSION = 66;

/** Sign successive versions of `initial` until it reaches `version`. */
async function extendPolicyHistory(
  initial: PrincipalPolicyBundleResponse,
  version: number,
  signingPrivateKey: Uint8Array,
): Promise<PrincipalPolicyBundleResponse> {
  let bundle = initial;
  while (bundle.currentState.version < version) {
    bundle = await signedPrincipalPolicyBundle({
      memberEnvelopes: bundle.currentMemberEnvelopes.envelopes,
      payloadCiphertext: bundle.currentPayload.ciphertext,
      projection: bundle.currentProjection,
      previousStates: [
        ...bundle.previousStates,
        {
          state: bundle.currentState,
          projection: bundle.currentProjection,
          grants: bundle.currentGrants,
        },
      ],
      signing: {
        ...bundle.currentState,
        grants: bundle.currentGrants,
        version: bundle.currentState.version + 1,
        prevStateHash: bundle.currentState.stateHash,
      },
      signingPrivateKey,
    });
  }
  return bundle;
}

async function signAuthorityRecoveryHistory() {
  const organization = await signOrganizationHistory();
  const fixture = organizationHistoryFixtureFrom(organization);
  const { signingPrivateKey } = organization.signer.signingKeyPair;
  const extend = (initial: PrincipalPolicyBundleResponse) =>
    extendPolicyHistory(initial, RECOVERY_HISTORY_VERSION, signingPrivateKey);
  const admin = await extend(fixture.admin);
  const group = await extend(fixture.created);
  const directory = await extend(
    await fixture.advanceDirectory(
      await fixture.advanceDirectory(fixture.afterCreation, admin),
      group,
    ),
  );
  return { admin, directory, group, organization };
}

// Signatures are the whole cost of this history, about 4s, so a test process
// signs it once. Each caller binds the fixture to its own structured copy, so
// no two test files share an object and caches keyed by object identity in the
// code under test start cold for every caller.
let sharedHistory: ReturnType<typeof signAuthorityRecoveryHistory> | undefined;

export async function signedAuthorityRecoveryHistory() {
  sharedHistory ??= signAuthorityRecoveryHistory();
  const { admin, directory, group, organization } = structuredClone(
    await sharedHistory,
  );
  const { signingPrivateKey } = organization.signer.signingKeyPair;
  return {
    ...organizationHistoryFixtureFrom(organization),
    admin,
    group,
    directory,
    extend: (initial: PrincipalPolicyBundleResponse, version: number) =>
      extendPolicyHistory(initial, version, signingPrivateKey),
  };
}

export async function createAuthorityRecoveryFixture(
  history: Pick<
    Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>,
    "directory" | "admin" | "group" | "resolveTrustedUserIdentity"
  > & { readonly organizationId: string },
) {
  const sqlite = await createTestExecSql("principal-authority-recovery");
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
    /** Set when the read named a held head; true when the reply was a bare head. */
    unchanged?: boolean;
  }[] = [];
  const controls: {
    mutate: ((page: PrincipalPolicyPageResponse) => void) | null;
    failureStatus?: number;
    /** Answer conditional reads like the API; otherwise ignore them. */
    conditional?: boolean;
    /** Reply to every conditional read with this bare head, matched or not. */
    forcedUnchangedHead?: ReferencedPrincipalHead;
  } = { mutate: null };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (controls.failureStatus)
        return Response.json(
          { error: "Unavailable" },
          { status: controls.failureStatus },
        );
      const url = new URL(request.url);
      const bundle = [...policies.values()].find((candidate) =>
        url.pathname.includes(candidate.currentState.principalId),
      );
      if (!bundle) return new Response("Not found", { status: 404 });
      const hash = url.searchParams.get("stateHash");
      if (hash && hash !== bundle.currentState.stateHash)
        return new Response("Changed pin", { status: 409 });
      const ifStateHash = url.searchParams.get("ifStateHash");
      if (controls.conditional && ifStateHash !== null) {
        const state = bundle.currentState;
        const unchanged =
          controls.forcedUnchangedHead !== undefined ||
          (ifStateHash === state.stateHash &&
            Number(url.searchParams.get("ifVersion")) === state.version);
        requests.push({
          principalId: state.principalId,
          afterVersion: 0,
          count: 0,
          unchanged,
        });
        if (unchanged) {
          return Response.json({
            unchanged: true,
            head: controls.forcedUnchangedHead ?? principalPolicyHead(bundle),
          });
        }
      }
      const afterVersion = Number(url.searchParams.get("afterVersion") ?? 0);
      const previousStates = bundle.previousStates.slice(
        afterVersion,
        afterVersion + 32,
      );
      const next = afterVersion + previousStates.length;
      requests.push({
        principalId: bundle.currentState.principalId,
        afterVersion,
        count: previousStates.length,
      });
      const page: PrincipalPolicyPageResponse = structuredClone({
        ...bundle,
        previousStates,
        historyPage: {
          afterVersion,
          nextAfterVersion:
            next === bundle.currentState.version - 1 ? null : next,
        },
      });
      controls.mutate?.(page);
      return Response.json(page);
    },
  });
  const apiClient = new ApiClient(server.url.origin);
  return {
    apiClient,
    policies,
    requests,
    controls,
    db: getClientSQLitePersistenceRuntime(sqlite.execSql).db,
    options: {
      historyReader: apiClient,
      execSql: sqlite.execSql,
      organizationId: history.organizationId,
      reference: principalPolicyHead(history.group),
      protection: {
        context: "authority-recovery-test",
        localKey: new Uint8Array(32).fill(9),
      },
      resolveTrustedUserIdentity: history.resolveTrustedUserIdentity,
      stillCurrent: () => true,
    },
    close() {
      server.stop(true);
      sqlite.close();
    },
  };
}
