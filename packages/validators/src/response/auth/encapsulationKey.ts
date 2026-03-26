import { isPlainObject } from "../../isPlainObject";

export interface EncapsulationKeyResponse {
  userId: string;
  encapsulationPublicKey: string;
}

export function isEncapsulationKeyResponse(
  value: unknown,
): value is EncapsulationKeyResponse {
  return (
    isPlainObject(value) &&
    typeof value["userId"] === "string" &&
    typeof value["encapsulationPublicKey"] === "string"
  );
}
