import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerMutationAuthor,
  ContainerShareApi,
} from "../../../data/containers/shared/types";
import { submitPlainContainerMutation } from "../../containers";

/**
 * A group share's POST. It carries the share's `stillCurrent`, so once the
 * share retires a late 401 neither renews the session nor replays the POST.
 */
export function submitGroupShare(
  share: {
    readonly apiClient: Pick<ContainerShareApi, "shareContainer">;
    readonly author: Pick<ContainerMutationAuthor, "organizationId">;
    readonly containerId: string;
    readonly stillCurrent?: (() => boolean) | undefined;
  },
  request: ContainerMutationRequest,
) {
  return submitPlainContainerMutation(() =>
    share.apiClient.shareContainer(share.containerId, request, {
      expectedPaymentRequiredOrganizationId: share.author.organizationId,
      stillCurrent: share.stillCurrent,
    }),
  );
}
