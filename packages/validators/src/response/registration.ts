import type { z } from "zod";
import { registerJsonSchemaRuntimeRefinements } from "../jsonSchema";
import { authChallengeHexStringSchema, loosePlainObject } from "../schema";
import {
  addProvisioningResponseIssues,
  organizationProvisioningResponseRefinements,
  organizationProvisioningResponseShape,
} from "./organizationProvisioning";

export const RegistrationResponseSchema = registerJsonSchemaRuntimeRefinements(
  loosePlainObject({
    ...organizationProvisioningResponseShape,
    challenge: authChallengeHexStringSchema,
  }).superRefine(addProvisioningResponseIssues),
  organizationProvisioningResponseRefinements,
);

export type RegistrationResponse = z.infer<typeof RegistrationResponseSchema>;

export function isRegistrationResponse(
  value: unknown,
): value is RegistrationResponse {
  return RegistrationResponseSchema.safeParse(value).success;
}
