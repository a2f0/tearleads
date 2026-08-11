import type { KeyingVerificationCode } from "@tearleads/crypto";
import { isKeyingVerificationError } from "../data/keyingProjectionVerification/error";
import {
  appendSecurityIncident,
  listSecurityIncidents,
} from "../data/persistence/securityIncidentPersistence";
import type {
  SecurityIncident,
  SecurityIncidentObjectKind,
  SecurityIncidentReporter,
} from "../data/securityIncidents";
import type { Database } from "./database";
import { createListenerSet } from "./listenerSet";

export type { SecurityIncident, SecurityIncidentObjectKind };

export type SecurityIncidentListener = (incident: SecurityIncident) => void;

export interface SecurityIncidents {
  /** Returns null while the local database is unavailable. */
  list(): Promise<ReadonlyArray<SecurityIncident> | null>;
  subscribe(listener: SecurityIncidentListener): () => void;
}

interface SecurityIncidentServiceOptions {
  readonly database: Database;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly onIncident?: SecurityIncidentListener | undefined;
  readonly trustDomain: string | null;
}

interface SecurityIncidentServiceResult {
  readonly incidents: SecurityIncidents;
  readonly report: SecurityIncidentReporter;
}

function verificationCode(error: unknown): KeyingVerificationCode | null {
  if (!isKeyingVerificationError(error) || !(error instanceof Error)) {
    return null;
  }
  const code = Reflect.get(error, "code");
  switch (code) {
    case "duplicate_entry":
    case "equivocation":
    case "hash_mismatch":
    case "invalid_domain":
    case "invalid_shape":
    case "key_epoch_reuse":
    case "missing_dependency":
    case "object_mismatch":
    case "rollback":
    case "signature_mismatch":
    case "signer_mismatch":
    case "stale_predecessor":
    case "unauthorized":
      return code;
    default:
      return null;
  }
}

export function createSecurityIncidentService(
  options: SecurityIncidentServiceOptions,
): SecurityIncidentServiceResult {
  const listeners = createListenerSet<[SecurityIncident]>();
  const observedErrors = new WeakSet<object>();

  const report: SecurityIncidentReporter = async (error, context) => {
    const code = verificationCode(error);
    if (!code) return;
    if (typeof error === "object" && error !== null) {
      if (observedErrors.has(error)) return;
    }

    const execSql = options.database.execSql;
    if (options.database.status !== "ready" || !execSql) {
      options.logError(
        "Security incident could not be persisted because the local database is unavailable",
        error,
      );
      return;
    }

    let incident: SecurityIncident;
    try {
      incident = await appendSecurityIncident(execSql, {
        code,
        detectedAt: new Date().toISOString(),
        evidenceHashes: context.evidenceHashes,
        id: crypto.randomUUID(),
        objectId: context.objectId,
        objectKind: context.objectKind,
        operation: context.operation,
        organizationId: context.organizationId,
        trustDomain: options.trustDomain,
      });
    } catch (persistenceError) {
      options.logError(
        "Security incident could not be persisted",
        persistenceError,
      );
      return;
    }

    if (typeof error === "object" && error !== null) {
      observedErrors.add(error);
    }

    listeners.notify(incident);
    try {
      options.onIncident?.(incident);
    } catch (callbackError) {
      options.logError("Security incident callback failed", callbackError);
    }
  };

  return {
    incidents: {
      async list() {
        const execSql = options.database.execSql;
        return options.database.status === "ready" && execSql
          ? listSecurityIncidents(execSql)
          : null;
      },
      subscribe: listeners.subscribe,
    },
    report,
  };
}
