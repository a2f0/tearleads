import { isPlainObject } from "../../isPlainObject";

export interface VerifyResponse {
  authenticated: boolean;
  error?: string;
}

export function isVerifyResponse(value: unknown): value is VerifyResponse {
  return (
    isPlainObject(value) &&
    typeof value["authenticated"] === "boolean" &&
    (value["error"] === undefined || typeof value["error"] === "string")
  );
}
