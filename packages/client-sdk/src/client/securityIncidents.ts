import { isKeyingVerificationCode } from "@tearleads/crypto";
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
const MAX_EVIDENCE_HASH_COUNT = 32;
const MAX_EVIDENCE_HASH_KEY_LENGTH = 64;
const MAX_EVIDENCE_HASH_VALUE_LENGTH = 256;
const MAX_INCIDENT_IDENTIFIER_LENGTH = 256;
const MAX_INCIDENT_OPERATION_LENGTH = 128;
const SECURITY_INCIDENT_RETRY_DELAY_MS = 250;
const SECURITY_INCIDENT_MAX_RETRY_DELAY_MS = 30_000;

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
  readonly dispose: () => void;
  readonly incidents: SecurityIncidents;
  readonly report: SecurityIncidentReporter;
}

function verificationCode(error: unknown): SecurityIncident["code"] | null {
  if (!isKeyingVerificationError(error)) return null;
  const code = Reflect.get(error, "code");
  return isKeyingVerificationCode(code)
    ? code
    : "unrecognized_verification_code";
}

interface RedactedIncident {
  readonly code: SecurityIncident["code"];
  readonly context: SecurityIncidentContext;
  readonly detectedAt: string;
  readonly lastDetectedAt: string;
  readonly occurrenceCount: number;
}

function boundIncidentText(value: string, maxLength: number): string {
  return value.slice(0, maxLength);
}

function boundNullableIncidentText(value: string | null): string | null {
  return value === null
    ? null
    : boundIncidentText(value, MAX_INCIDENT_IDENTIFIER_LENGTH);
}

function redactIncidentContext(
  context: SecurityIncidentContext,
): SecurityIncidentContext {
  return {
    evidenceHashes: Object.fromEntries(
      Object.entries(context.evidenceHashes ?? {})
        .filter(
          ([key, value]) =>
            key.length > 0 &&
            key.length <= MAX_EVIDENCE_HASH_KEY_LENGTH &&
            value.length <= MAX_EVIDENCE_HASH_VALUE_LENGTH,
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, MAX_EVIDENCE_HASH_COUNT),
    ),
    objectId: boundNullableIncidentText(context.objectId),
    objectKind: context.objectKind,
    operation: boundIncidentText(
      context.operation,
      MAX_INCIDENT_OPERATION_LENGTH,
    ),
    organizationId: boundNullableIncidentText(context.organizationId ?? null),
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
  private flushPromise: Promise<boolean> | null = null;
  private retryDelayMs = SECURITY_INCIDENT_RETRY_DELAY_MS;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribeDatabase: () => void;
  private disposed = false;

  constructor(
    private readonly options: SecurityIncidentServiceOptions,
    private readonly listeners: SecurityIncidentListeners,
  ) {
    this.unsubscribeDatabase = options.database.subscribe(() => {
      void this.flush();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeDatabase();
    if (this.retryTimeout) clearTimeout(this.retryTimeout);
    this.retryTimeout = null;
    this.bufferedIncidents.clear();
  }

  async persist(
    code: SecurityIncident["code"],
    context: SecurityIncidentContext,
  ): Promise<boolean> {
    if (this.disposed) return false;
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
      const persisted = await this.append(execSql, incident);
      if (persisted) this.notify(persisted);
      else {
        this.options.logError(
          "Security incident was dropped by the local retention limit",
        );
      }
      if (this.bufferedIncidents.size === 0) this.resetFlushRetry();
      return true;
    } catch (persistenceError) {
      const buffered = this.buffer(incident);
      if (buffered) this.scheduleFlushRetry();
      this.options.logError(
        "Security incident could not be persisted",
        persistenceError,
      );
      return buffered;
    }
  }

  async flush(): Promise<void> {
    if (this.disposed) return;
    for (;;) {
      const activeFlush = this.flushPromise ?? this.startFlushBatch();
      if (!activeFlush) return;
      const succeeded = await activeFlush;
      if (succeeded) this.resetFlushRetry();
      if (this.flushPromise && this.flushPromise !== activeFlush) continue;
      if (this.flushPromise === activeFlush) this.flushPromise = null;
      if (
        !succeeded ||
        this.bufferedIncidents.size === 0 ||
        this.options.database.status !== "ready"
      ) {
        return;
      }
    }
  }

  private startFlushBatch(): Promise<boolean> | null {
    const execSql = this.options.database.execSql;
    if (this.options.database.status !== "ready" || !execSql) return null;

    const pending = [...this.bufferedIncidents.values()];
    if (pending.length === 0) return null;
    this.bufferedIncidents.clear();
    const flush = this.flushPending(execSql, pending);
    this.flushPromise = flush;
    return flush;
  }

  private append(
    execSql: NonNullable<Database["execSql"]>,
    incident: RedactedIncident,
  ): Promise<SecurityIncident | null> {
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
    if (this.disposed) return false;
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
  ): Promise<boolean> {
    let succeeded = true;
    for (const incident of pending) {
      try {
        const persisted = await this.append(execSql, incident);
        if (persisted) this.notify(persisted);
      } catch (persistenceError) {
        succeeded = false;
        if (this.buffer(incident)) this.scheduleFlushRetry();
        this.options.logError(
          "Buffered security incident could not be persisted",
          persistenceError,
        );
      }
    }
    return succeeded;
  }

  private notify(incident: SecurityIncident): void {
    if (this.disposed) return;
    this.listeners.notify(incident);
    try {
      this.options.onIncident?.(incident);
    } catch (callbackError) {
      this.options.logError("Security incident callback failed", callbackError);
    }
  }

  private scheduleFlushRetry(): void {
    if (this.disposed || this.retryTimeout) return;
    const retryDelayMs = this.retryDelayMs;
    this.retryDelayMs = Math.min(
      this.retryDelayMs * 2,
      SECURITY_INCIDENT_MAX_RETRY_DELAY_MS,
    );
    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      if (this.disposed) return;
      void this.flush();
    }, retryDelayMs);
  }

  private resetFlushRetry(): void {
    this.retryDelayMs = SECURITY_INCIDENT_RETRY_DELAY_MS;
    if (!this.retryTimeout) return;
    clearTimeout(this.retryTimeout);
    this.retryTimeout = null;
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
      return false;
    }
    if (code === "unrecognized_verification_code") {
      options.logError(
        "Security incident used the fallback code because its verification code is unrecognized",
      );
    }

    return sink.persist(code, context);
  };

  const report: SecurityIncidentReporter = async (error, context) => {
    if (typeof error !== "object" || error === null) {
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
    dispose: () => sink.dispose(),
    incidents: {
      async list() {
        await sink.flush();
        const execSql = options.database.execSql;
        return options.database.status === "ready" && execSql
          ? listSecurityIncidents(execSql, options.trustDomain)
          : null;
      },
      subscribe: listeners.subscribe,
    },
    report,
  };
}
