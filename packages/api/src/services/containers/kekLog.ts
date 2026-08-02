import type { ContainerKekLogResponse } from "@tearleads/validators/response";
import { runContainerKekLogWorkflow } from "../../workflows/containers/kekLog";
import type { ApiServiceRuntime } from "../runtime";

export async function getContainerKekLog(
  runtime: ApiServiceRuntime,
  input: {
    readonly afterKeyEpoch: number;
    readonly containerId: string;
    readonly keyringForEpoch: number;
    readonly userId: string;
  },
): Promise<ContainerKekLogResponse> {
  return runContainerKekLogWorkflow(runtime.db, input);
}
