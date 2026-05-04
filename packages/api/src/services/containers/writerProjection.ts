import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { runContainerWriterProjectionWorkflow } from "../../workflows/containers/writerProjection";
import type { ApiServiceRuntime } from "../runtime";

export {
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
} from "../../workflows/containers/writerProjection";

export async function getContainerWriterProjection(
  runtime: ApiServiceRuntime,
  input: {
    readonly containerId: string;
    readonly userId: string;
  },
): Promise<ContainerWriterProjectionResponse> {
  return runContainerWriterProjectionWorkflow(runtime.db, input);
}
