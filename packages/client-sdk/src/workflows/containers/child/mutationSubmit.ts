import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { acknowledgeContainerMutation } from "../../../data/containers/shared/mutationAcknowledgement";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

/**
 * The shared tail of every remote child-container mutation: submit the plan,
 * bail on a refused response, and acknowledge the committed mutation before
 * handing the result back. Routing every operation through this helper is
 * what guarantees a mutation can never return unacknowledged.
 */
export async function submitAcknowledgedContainerMutation<
  TPlan extends Parameters<typeof acknowledgeContainerMutation>[0]["plan"],
>(input: {
  containerKey: Uint8Array;
  execSql: ExecSql;
  plan: TPlan;
  submit: () => Promise<ContainerMutationResponse | null>;
}): Promise<{
  containerKey: Uint8Array;
  plan: TPlan;
  response: ContainerMutationResponse;
} | null> {
  const response = await input.submit();
  if (!response) {
    return null;
  }

  await acknowledgeContainerMutation({
    execSql: input.execSql,
    plan: input.plan,
    response,
  });

  return {
    containerKey: input.containerKey,
    plan: input.plan,
    response,
  };
}
