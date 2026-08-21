import type {
  OrganizationDirectory,
  OrganizationGroupSummary,
} from "@symcrypt/client-sdk";
import { unknownErrorMessage } from "../../utils/unknownErrorMessage";
import type { OrgManagerView } from "./routes";

export type OrgManagerResource =
  | "dataUsage"
  | "directory"
  | "grants"
  | "groupContainers"
  | "groupDetails"
  | "organizationPolicyHistory"
  | "userDetail";

export type OrgManagerRequestKind = OrgManagerResource | "refresh";

export type DirectoryRefreshOptions = {
  afterMutation?: boolean;
  clearError?: boolean;
  localOnly?: boolean;
  manageLoading?: boolean;
  skipNextGroupDetailsEffect?: boolean;
};

export interface GroupDetailsEffectKey {
  readonly groupId: string | null;
  readonly stateHash: string | null;
}

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

export type DataUsageRefreshOptions = {
  clearError?: boolean;
  localOnly?: boolean;
  manageLoading?: boolean;
};

export type RefreshBehaviorOptions = {
  clearError?: boolean;
  manageLoading?: boolean;
};

export interface OrgManagerVisibleRefreshInput {
  getSelectedUserId: () => string | null;
  refreshDataUsage: (options?: DataUsageRefreshOptions) => Promise<void>;
  refreshDirectoryAndGroups: (
    options?: DirectoryRefreshOptions,
  ) => Promise<DirectoryRefreshResult>;
  refreshGrants: (options?: RefreshBehaviorOptions) => Promise<void>;
  refreshOrganizationPolicyHistory: (
    options?: RefreshBehaviorOptions,
  ) => Promise<void>;
  refreshSelectedGroupDetails: (
    groupId: string | null,
    options?: GroupDetailsRefreshOptions,
  ) => Promise<void>;
  refreshSelectedGroupContainers: (groupId: string | null) => Promise<void>;
  refreshSelectedUserDetail: (
    userId: string | null,
    options?: GroupDetailsRefreshOptions,
  ) => Promise<void>;
  view: OrgManagerView;
}

/** Refreshes the shared roster projection and only the currently visible view. */
export async function refreshOrgManagerVisibleData(
  input: OrgManagerVisibleRefreshInput,
): Promise<void> {
  const directoryResult = await input.refreshDirectoryAndGroups({
    clearError: false,
    manageLoading: false,
    ...(input.view === "groups" ? { skipNextGroupDetailsEffect: true } : {}),
  });

  const detailOptions = { clearError: false } as const;
  const viewOptions = { clearError: false, manageLoading: false } as const;
  // A no-op shared reconcile can still leave the visible detail stale, so a
  // manual refresh intentionally reloads that view-specific data.
  switch (input.view) {
    case "directory":
      await input.refreshSelectedUserDetail(
        input.getSelectedUserId(),
        detailOptions,
      );
      break;
    case "groups":
      await Promise.all([
        input.refreshSelectedGroupDetails(
          directoryResult.groupId,
          detailOptions,
        ),
        input.refreshSelectedGroupContainers(directoryResult.groupId),
      ]);
      break;
    case "grants":
      await input.refreshGrants(viewOptions);
      break;
    case "organization":
      await input.refreshOrganizationPolicyHistory(viewOptions);
      break;
    case "usage":
      await input.refreshDataUsage(viewOptions);
      break;
    case "billing":
    case "menu":
      break;
  }
}

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

interface ScopedRefresherInput<Result> {
  readonly apply: (result: Result) => void;
  readonly beginRequest: (kind: OrgManagerRequestKind) => () => boolean;
  readonly load: (() => Promise<Result>) | null;
  readonly onError?: (error: unknown) => void;
  readonly onSettled?: () => void;
  readonly onUnavailable?: (isCurrentRequest: () => boolean) => void;
  readonly options?: RefreshBehaviorOptions;
  readonly requestKind: OrgManagerRequestKind;
  readonly setError: (error: string | null) => void;
  readonly setLoading?: (loading: boolean) => void;
}

export async function runScopedRefresher<Result>(
  input: ScopedRefresherInput<Result>,
): Promise<void> {
  const isCurrentRequest = input.beginRequest(input.requestKind);
  if (input.load === null) {
    input.onUnavailable?.(isCurrentRequest);
    return;
  }

  const { shouldClearError, shouldManageLoading } = getRefreshBehavior(
    input.options ?? {},
  );
  if (input.setLoading) {
    setLoadingIfManaged(shouldManageLoading, input.setLoading, true);
  }
  clearErrorIfRequested(shouldClearError, input.setError);

  try {
    const result = await input.load();
    if (isCurrentRequest()) {
      input.apply(result);
    }
  } catch (error) {
    if (isCurrentRequest()) {
      if (input.onError) {
        input.onError(error);
      } else {
        setUnknownError(input.setError, error);
      }
    }
  } finally {
    if (isCurrentRequest()) {
      if (input.setLoading) {
        setLoadingIfManaged(shouldManageLoading, input.setLoading, false);
      }
      input.onSettled?.();
    }
  }
}

export function directoryLoadOptions({
  afterMutation,
  localOnly,
  skipNextGroupDetailsEffect,
}: DirectoryRefreshOptions): Pick<
  DirectoryRefreshOptions,
  "afterMutation" | "localOnly" | "skipNextGroupDetailsEffect"
> {
  return {
    ...(afterMutation === undefined ? {} : { afterMutation }),
    ...(localOnly === undefined ? {} : { localOnly }),
    ...(skipNextGroupDetailsEffect === undefined
      ? {}
      : { skipNextGroupDetailsEffect }),
  };
}
