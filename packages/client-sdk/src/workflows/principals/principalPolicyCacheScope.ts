import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { validatePrincipalPolicyBundleForCache } from "./principalPolicyCacheValidation";
import {
  directoryBindsGroupReference,
  type PolicyDirectoryLoader,
  type VerifiedPolicyDirectory,
} from "./principalPolicyOrganizationScope";

type ValidationInput = Parameters<
  typeof validatePrincipalPolicyBundleForCache
>[0];
type ValidatedPolicy = Extract<
  Awaited<ReturnType<typeof validatePrincipalPolicyBundleForCache>>,
  { ok: true }
>;

export async function scopeReferencedPolicyForCache(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly validation: ValidatedPolicy;
  readonly validationInput: Omit<ValidationInput, "bundle">;
  readonly loadDirectory: PolicyDirectoryLoader;
  readonly organizationId: string;
  readonly reloadBundle:
    | (() => Promise<PrincipalPolicyBundleResponse | null>)
    | null;
}): Promise<{
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly validation: ValidatedPolicy;
  readonly directory: VerifiedPolicyDirectory | null;
} | null> {
  const reference = input.validationInput.reference;
  if (reference.principalType === "organization") {
    return reference.principalId === input.organizationId
      ? { ...input, directory: null }
      : null;
  }
  let bundle = input.bundle;
  let validation = input.validation;
  let directory = await input.loadDirectory(false);
  if (!directoryBindsGroupReference(directory, validation.policy, reference))
    directory = await input.loadDirectory(true);
  if (
    !directoryBindsGroupReference(directory, validation.policy, reference) &&
    directory &&
    input.reloadBundle
  ) {
    const current = await input.reloadBundle();
    if (current) {
      const checked = await validatePrincipalPolicyBundleForCache({
        ...input.validationInput,
        bundle: current,
      });
      if (!checked.ok) throw checked.error;
      bundle = current;
      validation = checked;
    }
  }
  return directoryBindsGroupReference(directory, validation.policy, reference)
    ? { bundle, validation, directory }
    : null;
}
