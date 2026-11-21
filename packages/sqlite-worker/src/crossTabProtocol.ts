import {
  WORKER_DATABASE_DELETED_MESSAGE_TYPE,
  type WorkerResponse,
} from "./types";
import type { WorkerCrashDetail } from "./workerCrash";

type CrossTabEnvelope =
  | {
      readonly type: "request";
      readonly clientId: string;
      readonly hasClientLock?: boolean;
      readonly request: unknown;
    }
  | {
      readonly type: "response";
      readonly clientId: string;
      readonly response: unknown;
    }
  // The owner's worker crashed while serving `clientId` from another tab. An
  // Error cannot cross the channel, so the receiving tab mints its own from the
  // detail (see workerCrash.ts).
  | {
      readonly type: "error";
      readonly clientId: string;
      readonly detail: WorkerCrashDetail;
    };

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown, key: string): string | null {
  if (!isObject(value)) {
    return null;
  }

  const property = Reflect.get(value, key);
  return typeof property === "string" ? property : null;
}

function getNumber(value: unknown, key: string): number | null {
  if (!isObject(value)) {
    return null;
  }

  const property = Reflect.get(value, key);
  return typeof property === "number" ? property : null;
}

export function requestId(request: unknown): number | null {
  return getNumber(request, "id");
}

export function requestMethod(request: unknown): string | null {
  return getString(request, "method");
}

export function responseId(response: unknown): number | null {
  return getNumber(response, "id");
}

// The worker's unprompted notice that another connection deleted the database.
export function isDatabaseDeletedNotice(message: unknown): boolean {
  return getString(message, "type") === WORKER_DATABASE_DELETED_MESSAGE_TYPE;
}

// The outcome a worker response reports, or null for anything that is not one.
export function responseOutcome(
  response: unknown,
): { readonly ok: boolean; readonly message: string | null } | null {
  if (!isObject(response)) {
    return null;
  }

  const result = Reflect.get(response, "result");
  const ok = isObject(result) ? Reflect.get(result, "ok") : undefined;
  if (typeof ok !== "boolean") {
    return null;
  }

  return { ok, message: getString(result, "message") };
}

export function errorResponse(id: number, message: string): WorkerResponse {
  return {
    id,
    result: {
      ok: false,
      message,
    },
  };
}

export function isCrossTabEnvelope(value: unknown): value is CrossTabEnvelope {
  if (!isObject(value)) {
    return false;
  }

  const type = Reflect.get(value, "type");
  const clientId = Reflect.get(value, "clientId");
  if (typeof clientId !== "string") {
    return false;
  }

  if (type === "request") {
    return true;
  }

  if (type === "error") {
    return (
      typeof getString(Reflect.get(value, "detail"), "message") === "string"
    );
  }

  return type === "response";
}
