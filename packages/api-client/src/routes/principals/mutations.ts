import type {
  PutPrincipalMemberEnvelopesRequest,
  PutPrincipalStateRequest,
} from "@tearleads/validators/request";
import {
  isCurrentPrincipalMemberEnvelopesResponse,
  isPrincipalStateResponse,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

export function putPrincipalState(
  request: RequestFn,
  principalType: "group" | "organization",
  principalId: string,
  input: PutPrincipalStateRequest,
) {
  return request(
    `/principals/${pathSegment(principalType)}/${pathSegment(principalId)}/state`,
    isPrincipalStateResponse,
    "PUT",
    JSON.stringify(input),
  );
}

export function putPrincipalMemberEnvelopes(
  request: RequestFn,
  principalType: "group" | "organization",
  principalId: string,
  input: PutPrincipalMemberEnvelopesRequest,
) {
  return request(
    `/principals/${pathSegment(principalType)}/${pathSegment(principalId)}/member-envelopes`,
    isCurrentPrincipalMemberEnvelopesResponse,
    "PUT",
    JSON.stringify(input),
  );
}
