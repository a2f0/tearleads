import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { rebaseOnDeepestAncestor } from "../../containers/child/rekey/carriedDescendantRekeys";
import { withAuthoredPrincipalPolicies } from "./authoredPrincipalPolicyWarmer";
import type { PrincipalContainerRematerializationInput } from "./principalContainerRematerializationPlanning";

/** Plan the next group against container heads authored earlier in the same transaction. */
export function withPrecedingRematerialization(
  input: PrincipalContainerRematerializationInput,
): PrincipalContainerRematerializationInput {
  const preceding = input.preceding;
  if (!preceding) return input;
  const rebase = (served: ContainerWriterProjectionResponse) => {
    const own = preceding.projections.findLast(
      (projection) => projection.containerId === served.containerId,
    );
    const projection = own ?? served;
    return (
      rebaseOnDeepestAncestor(projection, preceding.projections)?.projection ??
      projection
    );
  };
  return {
    ...input,
    warmReferencedPrincipalPolicies: withAuthoredPrincipalPolicies(
      input.warmReferencedPrincipalPolicies,
      preceding.authored ?? [],
    ),
    apiClient: {
      ...input.apiClient,
      reciteContainer: input.apiClient.reciteContainer.bind(input.apiClient),
      getContainerWriterProjection: async (containerId) => {
        const projection =
          await input.apiClient.getContainerWriterProjection(containerId);
        return projection ? rebase(projection) : null;
      },
      getContainerWriterProjectionResult: async (containerId, options) => {
        const result = await input.apiClient.getContainerWriterProjectionResult(
          containerId,
          options,
        );
        return result.ok ? { ...result, data: rebase(result.data) } : result;
      },
    },
  };
}
