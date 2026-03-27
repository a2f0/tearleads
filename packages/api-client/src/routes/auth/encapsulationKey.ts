import { isEncapsulationKeyResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function getEncapsulationKey(request: RequestFn, userId: string) {
  return request(
    "/auth/encapsulation-key",
    isEncapsulationKeyResponse,
    "POST",
    JSON.stringify({ userId }),
  );
}
