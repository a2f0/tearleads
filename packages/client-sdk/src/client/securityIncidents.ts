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
  SecurityIncidentContext,
  SecurityIncidentObjectKind,
  SecurityIncidentReporter,
} from "../data/securityIncidents";
import type { Database } from "./database";
import { createListenerSet } from "./listenerSet";

export type { SecurityIncident, SecurityIncidentObjectKind };

export type SecurityIncidentListener = (incident: SecurityIncident) => void;

const MAX_BUFFERED_SECURITY_INCIDENTS = 100;

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

interface RedactedIncident {
  readonly code: KeyingVerificationCode;
  readonly context: SecurityIncidentContext;
  readonly detectedAt: string;
  readonly lastDetectedAt: string;
  readonly occurrenceCount: number;
}

function redactIncidentContext(
  context: SecurityIncidentContext,
): SecurityIncidentContext {
  return {
    evidenceHashes: Object.fromEntries(
      Object.entries(context.evidenceHashes ?? {}).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    objectId: context.objectId,
    objectKind: context.objectKind,
    operation: context.operation,
    organizationId: context.organizationId ?? null,
  };
}

function redactedIncidentKey(incident: RedactedIncident): string {
  return JSON.stringify([
    incident.code,
    incident.context.operation,
    incident.context.objectKind,
    incident.context.objectId,
    incident.context.organizationId ?? null,
    incident.context.evidenceHashes,
  ]);
}

type SecurityIncidentListeners = ReturnType<
  typeof createListenerSet<[SecurityIncident]>
>;

class SecurityIncidentSink {
  private readonly bufferedIncidents = new Map<string, RedactedIncident>();
  private flushPromise: Promise<void> | null = null;

  constructor(
    private readonly options: SecurityIncidentServiceOptions,
    private readonly listeners: SecurityIncidentListeners,
  ) {
    options.database.subscribe(() => {
      void this.flush();
    });
  }

  async persist(
    code: KeyingVerificationCode,
    context: SecurityIncidentContext,
  ): Promise<boolean> {
    const detectedAt = new Date().toISOString();
    const incident: RedactedIncident = {
      code,
      context: redactIncidentContext(context),
      detectedAt,
      lastDetectedAt: detectedAt,
      occurrenceCount: 1,
    };
    const execSql = this.options.database.execSql;
    if (this.options.database.status !== "ready" || !execSql) {
      return this.buffer(incident);
    }

    try {
      this.notify(await this.append(execSql, incident));
      return true;
    } catch (persistenceError) {
      const buffered = this.buffer(incident);
      this.options.logError(
        "Security incident could not be persisted",
        persistenceError,
      );
      return buffered;
    }
  }

  async flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    const execSql = this.options.database.execSql;
    if (this.options.database.status !== "ready" || !execSql) return;

    const pending = [...this.bufferedIncidents.values()];
    this.bufferedIncidents.clear();
    const flush = this.flushPending(execSql, pending);
    this.flushPromise = flush;
    try {
      await flush;
    } finally {
      if (this.flushPromise === flush) this.flushPromise = null;
    }
  }

  private append(
    execSql: NonNullable<Database["execSql"]>,
    incident: RedactedIncident,
  ): Promise<SecurityIncident> {
    return appendSecurityIncident(execSql, {
      code: incident.code,
      detectedAt: incident.detectedAt,
      evidenceHashes: incident.context.evidenceHashes,
      lastDetectedAt: incident.lastDetectedAt,
      objectId: incident.context.objectId,
      objectKind: incident.context.objectKind,
      occurrenceCount: incident.occurrenceCount,
      operation: incident.context.operation,
      organizationId: incident.context.organizationId,
      trustDomain: this.options.trustDomain,
    });
  }

  private buffer(incident: RedactedIncident): boolean {
    const key = redactedIncidentKey(incident);
    const existing = this.bufferedIncidents.get(key);
    if (existing) {
      this.bufferedIncidents.set(key, {
        ...existing,
        lastDetectedAt: incident.lastDetectedAt,
        occurrenceCount: existing.occurrenceCount + incident.occurrenceCount,
      });
      return true;
    }
    if (this.bufferedIncidents.size >= MAX_BUFFERED_SECURITY_INCIDENTS) {
      this.options.logError(
        "Security incident could not be buffered because the startup buffer is full",
      );
      return false;
    }
    this.bufferedIncidents.set(key, incident);
    return true;
  }

  private async flushPending(
    execSql: NonNullable<Database["execSql"]>,
    pending: ReadonlyArray<RedactedIncident>,
  ): Promise<void> {
    for (const incident of pending) {
      try {
        this.notify(await this.append(execSql, incident));
      } catch (persistenceError) {
        this.buffer(incident);
        this.options.logError(
          "Buffered security incident could not be persisted",
          persistenceError,
        );
      }
    }
  }

  private notify(incident: SecurityIncident): void {
    this.listeners.notify(incident);
    try {
      this.options.onIncident?.(incident);
    } catch (callbackError) {
      this.options.logError("Security incident callback failed", callbackError);
    }
  }
}

export function createSecurityIncidentService(
  options: SecurityIncidentServiceOptions,
): SecurityIncidentServiceResult {
  const listeners = createListenerSet<[SecurityIncident]>();
  const observedErrors = new WeakSet<object>();
  const incidentReports = new WeakMap<object, Promise<void>>();
  const sink = new SecurityIncidentSink(options, listeners);

  const persistIncident = async (
    error: unknown,
    context: SecurityIncidentContext,
  ): Promise<boolean> => {
    const code = verificationCode(error);
    if (!code) {
      if (isKeyingVerificationError(error)) {
        options.logError(
          "Security incident could not be persisted because its verification code is unrecognized",
        );
      }
      return false;
    }

    return sink.persist(code, context);
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
    const pending = persistIncident(error, context)
      .then((retained) => {
        if (retained) observedErrors.add(error);
      })
      .finally(() => {
        incidentReports.delete(error);
      });
    incidentReports.set(error, pending);
    await pending;
  };

  return {
    incidents: {
      async list() {
        await sink.flush();
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
