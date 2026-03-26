import {
  type EncapsulationKeyResponse,
  isEncapsulationKeyResponse,
} from "@tearleads/validators/response";
import { request } from "../../util/request";

export function getEncapsulationKey(
  userId: string,
): Promise<EncapsulationKeyResponse> {
  return request(
    `/auth/encapsulation-key/${userId}`,
    isEncapsulationKeyResponse,
    "GET",
  );
}
