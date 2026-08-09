import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import type { VerifiedPrincipalPolicy } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  getCurrentPrincipalState,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";
import { buildPrincipalPolicyForStateWithExecutor } from "./principalPolicyBundleRecords";
import { PrincipalPolicyError } from "./shared";
import { verifyStoredPrincipalPolicyBundle } from "./storedPrincipalPolicyVerification";

interface VerifiedPrincipalPolicyBundle {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly policy: VerifiedPrincipalPolicy;
}

export async function getVerifiedPrincipalPolicyForStateWithExecutor(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
): Promise<VerifiedPrincipalPolicyBundle> {
  const bundle = await buildPrincipalPolicyForStateWithExecutor(
    executor,
    currentState,
  );
  return {
    bundle,
    policy: await verifyStoredPrincipalPolicyBundle({ bundle, executor }),
  };
}

export async function getPrincipalPolicyForStateWithExecutor(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
): Promise<PrincipalPolicyBundleResponse> {
  return (
    await getVerifiedPrincipalPolicyForStateWithExecutor(executor, currentState)
  ).bundle;
}

export async function getCurrentPrincipalPolicyWithExecutor(
  executor: DatabaseSession,
  principalType: "group" | "organization",
  principalId: string,
): Promise<PrincipalPolicyBundleResponse> {
  const currentState = await getCurrentPrincipalState(
    principalType,
    principalId,
    executor,
  );

  if (!currentState) {
    throw new PrincipalPolicyError("Principal state not found", 404);
  }
  return getPrincipalPolicyForStateWithExecutor(executor, currentState);
}

export async function runGetCurrentPrincipalPolicyWorkflow(
  db: ApiDatabase,
  principalType: "group" | "organization",
  principalId: string,
): Promise<PrincipalPolicyBundleResponse> {
  return db.transaction((tx) =>
    getCurrentPrincipalPolicyWithExecutor(tx, principalType, principalId),
  );
}
