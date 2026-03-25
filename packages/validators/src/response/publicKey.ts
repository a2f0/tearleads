import { isPlainObject } from "../isPlainObject";

export interface PublicKeyResponse {
  message: string;
  userId: string;
}

export function isPublicKeyResponse(
  value: unknown,
): value is PublicKeyResponse {
  return (
    isPlainObject(value) &&
    typeof value["message"] === "string" &&
    typeof value["userId"] === "string"
  );
}
