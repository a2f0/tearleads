import { isPlainObject } from "../../isPlainObject";

export interface VerifyResponse {
  authenticated: boolean;
  token?: string;
  error?: string;
}

export function isVerifyResponse(value: unknown): value is VerifyResponse {
  return (
    isPlainObject(value) &&
    typeof value["authenticated"] === "boolean" &&
    (value["token"] === undefined || typeof value["token"] === "string") &&
    (value["error"] === undefined || typeof value["error"] === "string")
  );
}
