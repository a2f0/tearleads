import {
  ErrorResponseSchema,
  RootIdentitySuspensionResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import { defineJsonOperation } from "./definition";
import { RootIdentityPathParamsSchema } from "./root";

const rootSuspensionFailureResponses = {
  400: ErrorResponseSchema,
  401: SessionFailureResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  500: ErrorResponseSchema,
} as const;

/**
 * Suspends an identity: its devices can no longer sign in, and every live
 * session is revoked. Repeating it is harmless and sweeps sessions again.
 * Refused with 409 for a root identity or the operator's own, since root
 * standing is managed only through the API CLI.
 */
export const suspendRootIdentityOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    ...rootSuspensionFailureResponses,
    409: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500],
  id: "root.identities.suspension.put",
  method: "PUT",
  params: RootIdentityPathParamsSchema,
  path: "/root/identities/{userId}/suspension",
  responses: {
    200: RootIdentitySuspensionResponseSchema,
  },
});

/** Lifts a suspension so the identity's devices can sign in again. */
export const liftRootIdentitySuspensionOperation = defineJsonOperation({
  auth: "session",
  failureResponses: rootSuspensionFailureResponses,
  failureStatuses: [400, 401, 403, 404, 500],
  id: "root.identities.suspension.delete",
  method: "DELETE",
  params: RootIdentityPathParamsSchema,
  path: "/root/identities/{userId}/suspension",
  responses: {
    200: RootIdentitySuspensionResponseSchema,
  },
});
