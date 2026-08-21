import type {
  ContainerInfo,
  ContainerShareAccessLevel,
  OrganizationDirectoryAndGroups,
  OrganizationGroupSummary,
} from "@symcrypt/client-sdk";
import { useEffect, useRef } from "react";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";

export const DEFAULT_SHARE_ACCESS_LEVEL: ContainerShareAccessLevel = "write";
const EMPTY_ORGANIZATION_GROUPS: ReadonlyArray<OrganizationGroupSummary> = [];

export type ExplorerContainerInfoGrant = NonNullable<
  ContainerInfo["remoteInfo"]
>["grants"][number];

export interface ReloadExplorerContainerInfoOptions {
  optimisticGrant?: ExplorerContainerInfoGrant | null;
  preserveDrafts?: boolean;
  resetDrafts?: boolean;
}

export type ReloadExplorerContainerInfo = (
  options?: ReloadExplorerContainerInfoOptions,
) => Promise<void>;

export function upsertContainerInfoGrant(
  info: ContainerInfo,
  grant: ExplorerContainerInfoGrant | null,
  containerId: string,
): ContainerInfo {
  if (!grant || !info.remoteInfo) {
    return info;
  }
  const existingGrantIndex = info.remoteInfo.grants.findIndex(
    (candidate) =>
      candidate.subjectType === grant.subjectType &&
      candidate.subjectId === grant.subjectId,
  );
  const grants =
    existingGrantIndex === -1
      ? [...info.remoteInfo.grants, grant]
      : info.remoteInfo.grants.map((candidate, index) =>
          index === existingGrantIndex ? { ...candidate, ...grant } : candidate,
        );
  const directGrantRow = {
    ...grant,
    inherited: false,
    sourceContainerId: containerId,
  };
  const existingGrantRowIndex = info.remoteInfo.grantRows.findIndex(
    (candidate) =>
      !candidate.inherited &&
      candidate.sourceContainerId === containerId &&
      candidate.subjectType === grant.subjectType &&
      candidate.subjectId === grant.subjectId,
  );
  const grantRows =
    existingGrantRowIndex === -1
      ? [...info.remoteInfo.grantRows, directGrantRow]
      : info.remoteInfo.grantRows.map((candidate, index) =>
          index === existingGrantRowIndex
            ? { ...candidate, ...directGrantRow }
            : candidate,
        );
  return {
    ...info,
    remoteInfo: { ...info.remoteInfo, grantRows, grants },
  };
}

export function getContainerInfoShareableGroups(
  remoteInfo: NonNullable<ContainerInfo["remoteInfo"]>,
) {
  const directlyGrantedGroupIds = new Set(
    remoteInfo.grants.flatMap((grant) =>
      grant.subjectType === "group" ? [grant.subjectId] : [],
    ),
  );
  return remoteInfo.groups.filter(
    (group) =>
      group.currentState && !directlyGrantedGroupIds.has(group.groupId),
  );
}

function replaceContainerInfoOrganizationGroups(
  info: ContainerInfo,
  groups: ReadonlyArray<OrganizationGroupSummary>,
): ContainerInfo {
  return info.remoteInfo
    ? { ...info, remoteInfo: { ...info.remoteInfo, groups: [...groups] } }
    : info;
}

function nextDraftShareGroupId(
  info: ContainerInfo,
  currentGroupId: string,
  resetDrafts: boolean,
): string {
  const shareableGroups = info.remoteInfo
    ? getContainerInfoShareableGroups(info.remoteInfo)
    : [];
  if (
    !resetDrafts &&
    shareableGroups.some((group) => group.groupId === currentGroupId)
  ) {
    return currentGroupId;
  }
  return shareableGroups[0]?.groupId ?? "";
}

export function useMountedRef() {
  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  return isMountedRef;
}

function commitContainerInfo(params: {
  containerId: string;
  containerInfoRef: { current: ContainerInfo | null };
  info: ContainerInfo;
  options?: ReloadExplorerContainerInfoOptions;
  setContainerInfo: (info: ContainerInfo) => void;
  setDraftShareGroupId: (updater: (current: string) => string) => void;
}) {
  const options = params.options ?? {};
  const updatedInfo = upsertContainerInfoGrant(
    params.info,
    options.optimisticGrant ?? null,
    params.containerId,
  );
  params.containerInfoRef.current = updatedInfo;
  params.setContainerInfo(updatedInfo);
  if (!options.preserveDrafts) {
    params.setDraftShareGroupId((current) =>
      nextDraftShareGroupId(updatedInfo, current, options.resetDrafts ?? false),
    );
  }
}

export function useContainerInfoAutoReload(params: {
  containerId: string;
  presentationScope?: object | null | undefined;
  reloadContainerInfo: ReloadExplorerContainerInfo;
  reloadToken?: string | null | undefined;
}) {
  const previousContainerIdRef = useRef<string | null>(null);
  const previousPresentationScopeRef = useRef(params.presentationScope);
  useEffect(() => {
    const resetDrafts =
      previousContainerIdRef.current !== params.containerId ||
      previousPresentationScopeRef.current !== params.presentationScope;
    previousContainerIdRef.current = params.containerId;
    previousPresentationScopeRef.current = params.presentationScope;
    if (params.presentationScope === null) {
      return;
    }
    void params.reloadContainerInfo({
      preserveDrafts: !resetDrafts,
      resetDrafts,
    });
  }, [
    params.containerId,
    params.presentationScope,
    params.reloadContainerInfo,
    params.reloadToken,
  ]);
}

export function useContainerInfoOrganizationGroups(params: {
  readonly containerId: string;
  readonly containerInfoRef: { current: ContainerInfo | null };
  readonly projection?: OrganizationDirectoryAndGroups | null | undefined;
  readonly revision: number;
  readonly setContainerInfo: (info: ContainerInfo) => void;
  readonly setDraftShareGroupId: (updater: (current: string) => string) => void;
}) {
  const groups =
    params.revision > 0
      ? (params.projection?.groups ?? EMPTY_ORGANIZATION_GROUPS)
      : null;
  const groupsRef = useRef<ReadonlyArray<OrganizationGroupSummary> | null>(
    groups,
  );
  groupsRef.current = groups;
  useEffect(() => {
    if (groups === null || !params.containerInfoRef.current) {
      return;
    }
    commitContainerInfo({
      containerId: params.containerId,
      containerInfoRef: params.containerInfoRef,
      info: replaceContainerInfoOrganizationGroups(
        params.containerInfoRef.current,
        groups,
      ),
      setContainerInfo: params.setContainerInfo,
      setDraftShareGroupId: params.setDraftShareGroupId,
    });
  }, [
    groups,
    params.containerId,
    params.containerInfoRef,
    params.setContainerInfo,
    params.setDraftShareGroupId,
  ]);
  return groupsRef;
}

interface ContainerInfoReloadRuntime {
  readonly containerId: string;
  readonly containerInfoRef: { current: ContainerInfo | null };
  readonly isMountedRef: { current: boolean };
  readonly loadContainerInfo: (containerId: string) => Promise<ContainerInfo>;
  readonly organizationGroupsRef: {
    current: ReadonlyArray<OrganizationGroupSummary> | null;
  };
  readonly requestIdRef: { current: number };
  readonly setContainerInfo: (info: ContainerInfo | null) => void;
  readonly setContainerInfoError: (error: string | null) => void;
  readonly setDraftShareAccessLevel: (value: ContainerShareAccessLevel) => void;
  readonly setDraftShareGroupId: (
    value: string | ((current: string) => string),
  ) => void;
  readonly setIsLoadingContainerInfo: (value: boolean) => void;
  readonly setPanelError: (error: string | null) => void;
}

function isCurrentRequest(
  runtime: ContainerInfoReloadRuntime,
  requestId: number,
): boolean {
  return (
    runtime.isMountedRef.current && runtime.requestIdRef.current === requestId
  );
}

function resetContainerInfoState(runtime: ContainerInfoReloadRuntime): void {
  runtime.containerInfoRef.current = null;
  runtime.setContainerInfo(null);
  runtime.setDraftShareGroupId("");
  runtime.setDraftShareAccessLevel(DEFAULT_SHARE_ACCESS_LEVEL);
  runtime.setPanelError(null);
}

export async function reloadExplorerContainerInfo(
  runtime: ContainerInfoReloadRuntime,
  options: ReloadExplorerContainerInfoOptions,
): Promise<void> {
  const requestId = runtime.requestIdRef.current + 1;
  const commitInfo = (
    info: ContainerInfo,
    commitOptions: ReloadExplorerContainerInfoOptions = {},
  ) =>
    commitContainerInfo({
      containerId: runtime.containerId,
      containerInfoRef: runtime.containerInfoRef,
      info,
      options: commitOptions,
      setContainerInfo: runtime.setContainerInfo,
      setDraftShareGroupId: runtime.setDraftShareGroupId,
    });
  runtime.requestIdRef.current = requestId;
  runtime.setIsLoadingContainerInfo(true);
  runtime.setContainerInfoError(null);
  if (options.resetDrafts) {
    resetContainerInfoState(runtime);
  }
  const optimisticInfo = runtime.containerInfoRef.current;
  if (options.optimisticGrant && !options.resetDrafts && optimisticInfo) {
    commitInfo(optimisticInfo, { optimisticGrant: options.optimisticGrant });
  }
  try {
    const loadedInfo = await runtime.loadContainerInfo(runtime.containerId);
    if (!isCurrentRequest(runtime, requestId)) {
      return;
    }
    const groups = runtime.organizationGroupsRef.current;
    commitInfo(
      groups
        ? replaceContainerInfoOrganizationGroups(loadedInfo, groups)
        : loadedInfo,
      options,
    );
  } catch (error) {
    if (!isCurrentRequest(runtime, requestId)) {
      return;
    }
    if (!options.optimisticGrant || !runtime.containerInfoRef.current) {
      runtime.containerInfoRef.current = null;
      runtime.setContainerInfo(null);
    }
    runtime.setContainerInfoError(unknownErrorMessage(error));
  } finally {
    if (isCurrentRequest(runtime, requestId)) {
      runtime.setIsLoadingContainerInfo(false);
    }
  }
}
