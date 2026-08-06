import type { z } from "zod";
import { registerJsonSchemaRuntimeRefinements } from "../jsonSchema";
import { organizationProvisioningCommittedUpdateIdsRefinement } from "../organizationProvisioningRefinements";
import { authChallengeHexStringSchema, loosePlainObject } from "../schema";
import {
  addCommittedUpdateIdIssues,
  organizationProvisioningResponseShape,
} from "./organizationProvisioning";

export const RegistrationResponseSchema = registerJsonSchemaRuntimeRefinements(
  loosePlainObject({
    ...organizationProvisioningResponseShape,
    challenge: authChallengeHexStringSchema,
  }).superRefine(addCommittedUpdateIdIssues),
  [organizationProvisioningCommittedUpdateIdsRefinement],
);

export type RegistrationResponse = z.infer<typeof RegistrationResponseSchema>;

export function isRegistrationResponse(
  value: unknown,
): value is RegistrationResponse {
  return RegistrationResponseSchema.safeParse(value).success;
}
