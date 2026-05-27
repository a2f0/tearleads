import { isEncapsulationKeyResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

export function getEncapsulationKey(request: RequestFn, userId: string) {
  return request(
    `/auth/encapsulation-key/${pathSegment(userId)}`,
    isEncapsulationKeyResponse,
    "GET",
  );
}
