import { expect, test } from "bun:test";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { ContainerPathTooDeepError } from "../../../data/containers/shared/containerPathLimits";
import { submitAcknowledgedContainerMutation } from "./mutationSubmit";

type SubmitInput = Parameters<typeof submitAcknowledgedContainerMutation>[0];

function refusal(code: string) {
  return {
    apiClient: {} as SubmitInput["apiClient"],
    author: {} as SubmitInput["author"],
    containerKey: new Uint8Array(32),
    execSql: (async () => []) as SubmitInput["execSql"],
    plan: {} as SubmitInput["plan"],
    recitationPolicies: [],
    reportSecurityIncident: async () => {},
    submit: async () => ({ code, ok: false as const, status: 409 }),
  } satisfies SubmitInput;
}

test("a path-length refusal is final, unlike other refusals", async () => {
  await expect(
    submitAcknowledgedContainerMutation(
      refusal(CONTAINER_MUTATION_ERROR_CODES.pathTooDeep),
    ),
  ).rejects.toBeInstanceOf(ContainerPathTooDeepError);
  await expect(
    submitAcknowledgedContainerMutation(
      refusal(CONTAINER_MUTATION_ERROR_CODES.stateStale),
    ),
  ).resolves.toBeNull();
});
