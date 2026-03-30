import { isPlainObject } from "../../isPlainObject";
import { hasStringProperty } from "../../util";

export interface EncapsulationKeyResponse {
  userId: string;
  encapsulationPublicKey: string;
}

export function isEncapsulationKeyResponse(
  value: unknown,
): value is EncapsulationKeyResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "userId") &&
    hasStringProperty(value, "encapsulationPublicKey")
  );
}
