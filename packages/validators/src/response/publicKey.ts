import { isRecord } from "../isRecord";

export interface PublicKeyResponse {
  message: string;
}

export function isPublicKeyResponse(
  value: unknown,
): value is PublicKeyResponse {
  return isRecord(value) && typeof value["message"] === "string";
}
