import type { WorkerResponse } from "./types";

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

  return type === "response";
}
