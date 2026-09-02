import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { acknowledgeContainerMutation } from "../../../data/containers/shared/mutationAcknowledgement";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

/**
 * The shared tail of the plain remote child-container mutations (user share,
 * rekey, revoke, move): submit the plan, bail on a refused response, and
 * acknowledge the committed mutation before handing the result back. Create
 * and the group-share variant own their tails deliberately — create's
 * submission handles the lost-response conflict, and group share caches the
 * rotated policy only after the acknowledge.
 */
export async function submitAcknowledgedContainerMutation<
  TPlan extends Parameters<typeof acknowledgeContainerMutation>[0]["plan"],
>(input: {
  containerKey: Uint8Array;
  execSql: ExecSql;
  plan: TPlan;
  stillCurrent?: (() => boolean) | undefined;
  submit: () => Promise<ContainerMutationResponse | null>;
}): Promise<{
  containerKey: Uint8Array;
  plan: TPlan;
  response: ContainerMutationResponse;
} | null> {
  if (input.stillCurrent?.() === false) return null;
  const response = await input.submit();
  if (!response) {
    return null;
  }

  await acknowledgeContainerMutation({
    execSql: input.execSql,
    plan: input.plan,
    response,
    stillCurrent: input.stillCurrent,
  });
  if (input.stillCurrent?.() === false) return null;

  return {
    containerKey: input.containerKey,
    plan: input.plan,
    response,
  };
}
