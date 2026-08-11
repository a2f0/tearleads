import {
  isKeyingVerificationCode,
  type KeyingVerificationCode,
} from "@tearleads/crypto";
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
  if (!isKeyingVerificationError(error)) return null;
  const code = Reflect.get(error, "code");
  return isKeyingVerificationCode(code) ? code : null;
}

export function createSecurityIncidentService(
  options: SecurityIncidentServiceOptions,
): SecurityIncidentServiceResult {
  const listeners = createListenerSet<[SecurityIncident]>();
  const observedErrors = new WeakSet<object>();
  const incidentReports = new WeakMap<object, Promise<void>>();

  const persistIncident: SecurityIncidentReporter = async (error, context) => {
    const code = verificationCode(error);
    if (!code) {
      if (isKeyingVerificationError(error)) {
        options.logError(
          "Security incident could not be persisted because its verification code is unrecognized",
        );
      }
      return;
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

  const report: SecurityIncidentReporter = async (error, context) => {
    if (typeof error !== "object" || error === null) {
      await persistIncident(error, context);
      return;
    }
    if (observedErrors.has(error)) return;
    const inFlight = incidentReports.get(error);
    if (inFlight) {
      await inFlight;
      return;
    }
    const pending = persistIncident(error, context).finally(() => {
      incidentReports.delete(error);
    });
    incidentReports.set(error, pending);
    await pending;
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
