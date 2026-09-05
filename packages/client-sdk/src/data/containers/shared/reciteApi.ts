import type { ContainerReciteRequest } from "@tearleads/validators/request";
import type { ContainerReciteResponse } from "@tearleads/validators/response";
import type { ContainerMutationRequestOptions } from "./mutationRequestOptions";

export interface ContainerReciteApi {
  reciteContainer(
    containerId: string,
    input: ContainerReciteRequest,
    options?: ContainerMutationRequestOptions,
  ): Promise<ContainerReciteResponse | null>;
}
