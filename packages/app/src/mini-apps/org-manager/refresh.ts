import type {
  OrganizationDirectory,
  OrganizationGroupSummary,
} from "@tearleads/client-sdk";
import { unknownErrorMessage } from "../../utils/unknownErrorMessage";

export type DirectoryRefreshOptions = {
  clearError?: boolean;
  manageLoading?: boolean;
  skipNextGroupDetailsEffect?: boolean;
};

export type DirectoryRefreshResult =
  | {
      didLoad: false;
      groupId: string | null;
    }
  | {
      didLoad: true;
      directory: OrganizationDirectory;
      groupId: string | null;
      groups: ReadonlyArray<OrganizationGroupSummary>;
    };

export type GroupDetailsRefreshOptions = {
  clearError?: boolean;
};

export type GrantsRefreshOptions = {
  clearError?: boolean;
  manageLoading?: boolean;
};

export type DataUsageRefreshOptions = {
  clearError?: boolean;
  manageLoading?: boolean;
};

export type RefreshBehaviorOptions = {
  clearError?: boolean;
  manageLoading?: boolean;
};

export function setUnknownError(
  setError: (error: string | null) => void,
  error: unknown,
) {
  setError(unknownErrorMessage(error));
}

export function getRefreshBehavior(options: RefreshBehaviorOptions) {
  return {
    shouldClearError: options.clearError ?? true,
    shouldManageLoading: options.manageLoading ?? true,
  };
}

export function clearErrorIfRequested(
  shouldClearError: boolean,
  setError: (error: string | null) => void,
) {
  if (shouldClearError) {
    setError(null);
  }
}

export function setLoadingIfManaged(
  shouldManageLoading: boolean,
  setLoading: (loading: boolean) => void,
  loading: boolean,
) {
  if (shouldManageLoading) {
    setLoading(loading);
  }
}

export function directoryLoadOptions({
  skipNextGroupDetailsEffect,
}: DirectoryRefreshOptions): Pick<
  DirectoryRefreshOptions,
  "skipNextGroupDetailsEffect"
> {
  return skipNextGroupDetailsEffect === undefined
    ? {}
    : { skipNextGroupDetailsEffect };
}
