import {
  type EncapsulationKeyResponse,
  isEncapsulationKeyResponse,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function getEncapsulationKey(
  request: RequestFn,
  userId: string,
): Promise<EncapsulationKeyResponse> {
  return request(
    `/auth/encapsulation-key/${userId}`,
    isEncapsulationKeyResponse,
    "GET",
  );
}
