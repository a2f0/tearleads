import { isRecord } from "../../isRecord";

export interface VerifyResponse {
  authenticated: boolean;
  error?: string;
}

export function isVerifyResponse(value: unknown): value is VerifyResponse {
  return (
    isRecord(value) &&
    typeof value["authenticated"] === "boolean" &&
    (value["error"] === undefined || typeof value["error"] === "string")
  );
}
