import type {
  ContainerNode,
  OrganizationDirectory,
} from "@tearleads/client-sdk";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  useTearleads,
  useTearleadsRuntime,
} from "../../../providers/sdk/TearleadsProvider";
import {
  getLocalRosterProfileDisplayNames,
  getRosterProfileBindingsByLocalId,
  getRosterProfileBindingsWithoutLocalRow,
  getRosterProfileDocumentBindingKey,
  getRosterProfileDocumentIds,
  type RosterProfileBinding,
} from "../../../stores/org-manager/rosterProfileDisplayNames";
import { hydrateRosterProfileDocument } from "../../../stores/org-manager/rosterProfileHydration";
import {
  initialRosterProfileHydration,
  type RosterProfileHydrationEvent,
  transitionRosterProfileHydration,
} from "../../../stores/org-manager/rosterProfileHydrationMachine";
import {
  recordRosterProfilePull,
  selectRosterProfilePulls,
} from "../../../stores/org-manager/rosterProfilePullLedger";
import { EMPTY_PROFILE_DISPLAY_NAMES } from "../display";

interface OrgManagerProfileDisplayNamesParams {
  appData: ReturnType<typeof useTearleadsRuntime>;
  canLoadAuthenticatedOrgData: boolean;
  directory: OrganizationDirectory | null;
  findRosterProfileContainer: () => Promise<ContainerNode | null>;
  selectedUserIdRef: { current: string | null };
  subscribeToContainers: (listener: () => void) => () => void;
  tearleads: ReturnType<typeof useTearleads>;
}

interface ProfileDisplayNameScope {
  readonly bindingKey: string;
  readonly domainScope: ReturnType<
    typeof useTearleadsRuntime
  >["state"]["domainScope"];
  readonly organizationId: string;
  readonly userId: string;
}

interface ProfileDisplayNameState extends ProfileDisplayNameScope {
  readonly names: ReadonlyMap<string, string>;
}

function getProfileBindingKey(
  directory: OrganizationDirectory | null,
  organizationId: string | null,
): string {
  if (!directory || directory.organizationId !== organizationId) {
    return "purged";
  }
  return JSON.stringify(
    directory.users
      .map(getRosterProfileDocumentBindingKey)
      .filter((key): key is string => key !== null)
      .sort(),
  );
}

function matchesScope(
  state: ProfileDisplayNameState | null,
  input: ProfileDisplayNameScope,
): state is ProfileDisplayNameState {
  return (
    state?.bindingKey === input.bindingKey &&
    state.domainScope === input.domainScope &&
    state.organizationId === input.organizationId &&
    state.userId === input.userId
  );
}

/** One load's hydration budget, matching Explorer's attribution probe. */
export const MAX_ROSTER_PROFILE_HYDRATIONS_PER_LOAD = 32;

interface RosterProfileHydrationInput {
  readonly findRosterProfileContainer: () => Promise<ContainerNode | null>;
  readonly organizationId: string;
  readonly subscribeToContainers: (listener: () => void) => () => void;
  readonly tearleads: ReturnType<typeof useTearleads>;
}

/**
 * Pulls, one at a time, the roster profiles this device holds no row for.
 * Profiles never reach a device through container discovery, so without this
 * an admin's new device shows user IDs. Rows persist, so a later load only
 * hydrates what is still missing. Each pulled profile reaches the caller
 * through `documents.subscribe`. A profile that fails to pull is logged and
 * skipped, and later loads try it after the others (`rosterProfilePullLedger`).
 */
async function hydrateMissingRosterProfiles(
  input: RosterProfileHydrationInput & {
    readonly bindings: ReadonlyArray<RosterProfileBinding>;
    readonly signal: AbortSignal;
  },
): Promise<"containerMissing" | "finished"> {
  const container = await input.findRosterProfileContainer();
  if (!container) return "containerMissing";
  const bindings = selectRosterProfilePulls(
    input.tearleads,
    input.bindings,
    MAX_ROSTER_PROFILE_HYDRATIONS_PER_LOAD,
  );
  for (const binding of bindings) {
    if (input.signal.aborted) break;
    let completed = false;
    try {
      completed = await hydrateRosterProfileDocument({
        containerId: container.id,
        documents: input.tearleads.documents,
        organizationId: input.organizationId,
        profileDocumentId: binding.profileDocumentId,
        signal: input.signal,
        userId: binding.userId,
      });
    } catch (error) {
      if (!input.signal.aborted) {
        input.tearleads.logError(
          "Failed to hydrate an organization roster profile",
          error,
        );
      }
    }
    if (input.signal.aborted) break;
    recordRosterProfilePull(input.tearleads, binding, completed);
  }
  return "finished";
}

/** Runs one load's `RosterProfileHydration` machine and its pulls. */
function startRosterProfileHydration(
  input: RosterProfileHydrationInput & { readonly isOrgAdmin: boolean },
) {
  let state = initialRosterProfileHydration(input.isOrgAdmin);
  const abort = new AbortController();
  const pull = async (bindings: ReadonlyArray<RosterProfileBinding>) => {
    let outcome: "containerMissing" | "finished" = "finished";
    try {
      outcome = await hydrateMissingRosterProfiles({
        ...input,
        bindings,
        signal: abort.signal,
      });
    } catch (error) {
      if (!abort.signal.aborted) {
        input.tearleads.logError(
          "Failed to hydrate organization roster profiles",
          error,
        );
      }
    }
    dispatch({ type: outcome });
  };
  const dispatch = (event: RosterProfileHydrationEvent) => {
    if (abort.signal.aborted) return;
    const previous = state;
    state = transitionRosterProfileHydration(previous, event);
    if (
      state.status === "running" &&
      (previous.status !== "running" || previous.attempt !== state.attempt)
    ) {
      void pull(state.bindings);
    }
  };
  const unsubscribe =
    state.status === "disabled"
      ? undefined
      : input.subscribeToContainers(() =>
          dispatch({ type: "containersChanged" }),
        );
  return {
    profilesMissing: (bindings: ReadonlyArray<RosterProfileBinding>) =>
      dispatch({ type: "profilesMissing", bindings }),
    stop: () => {
      abort.abort();
      unsubscribe?.();
    },
  };
}

function startLocalProfileDisplayNameLoad(
  input: Omit<RosterProfileHydrationInput, "organizationId"> & {
    readonly directory: OrganizationDirectory;
    readonly isOrgAdmin: boolean;
    readonly scope: ProfileDisplayNameScope;
    readonly setState: Dispatch<SetStateAction<ProfileDisplayNameState | null>>;
  },
): (() => void) | undefined {
  const profileBindingsByLocalId = getRosterProfileBindingsByLocalId({
    organizationId: input.scope.organizationId,
    users: input.directory.users,
  });
  if (profileBindingsByLocalId.size === 0) {
    return;
  }
  const profileDocumentIds = getRosterProfileDocumentIds(
    profileBindingsByLocalId,
  );
  let cancelled = false;
  const hydration = startRosterProfileHydration({
    findRosterProfileContainer: input.findRosterProfileContainer,
    isOrgAdmin: input.isOrgAdmin,
    organizationId: input.scope.organizationId,
    subscribeToContainers: input.subscribeToContainers,
    tearleads: input.tearleads,
  });
  let loadSequence = 0;
  const reload = async () => {
    const sequence = ++loadSequence;
    try {
      const documents = await input.tearleads.documents.list({
        documentKind: "contact",
      });
      const names = getLocalRosterProfileDisplayNames({
        documents,
        profileBindingsByLocalId,
      });
      if (!cancelled && sequence === loadSequence) {
        input.setState({ ...input.scope, names });
        hydration.profilesMissing(
          getRosterProfileBindingsWithoutLocalRow({
            documents,
            profileBindingsByLocalId,
          }),
        );
      }
    } catch (error) {
      if (!cancelled) {
        input.tearleads.logError(
          "Failed to load local organization roster display names",
          error,
        );
      }
    }
  };
  const unsubscribe = input.tearleads.documents.subscribe((document) => {
    if (document.documentId && profileDocumentIds.has(document.documentId)) {
      void reload();
    }
  });
  void reload();
  return () => {
    cancelled = true;
    hydration.stop();
    loadSequence += 1;
    unsubscribe();
  };
}

function updateSelectedProfileDisplayName(input: {
  readonly current: ProfileDisplayNameState | null;
  readonly displayName: string | null;
  readonly scope: ProfileDisplayNameScope;
  readonly selectedUserId: string;
}): ProfileDisplayNameState {
  const names = new Map(
    matchesScope(input.current, input.scope)
      ? input.current.names
      : EMPTY_PROFILE_DISPLAY_NAMES,
  );
  const displayName = input.displayName?.trim() ?? "";
  if (displayName.length > 0) {
    names.set(input.selectedUserId, displayName);
  } else {
    names.delete(input.selectedUserId);
  }
  return { ...input.scope, names };
}

function useSelectedProfileDisplayNameSetter(input: {
  readonly bindingKey: string;
  readonly canReadLocalProfiles: boolean;
  readonly domainScope: ProfileDisplayNameScope["domainScope"];
  readonly organizationId: string | null;
  readonly selectedUserIdRef: { current: string | null };
  readonly setState: Dispatch<SetStateAction<ProfileDisplayNameState | null>>;
  readonly userId: string | null;
}) {
  return useCallback(
    (displayName: string | null) => {
      const organizationId = input.organizationId;
      const selectedUserId = input.selectedUserIdRef.current;
      const userId = input.userId;
      if (
        !input.canReadLocalProfiles ||
        !organizationId ||
        !selectedUserId ||
        !userId
      ) {
        return;
      }
      input.setState((current) =>
        updateSelectedProfileDisplayName({
          current,
          displayName,
          scope: {
            bindingKey: input.bindingKey,
            domainScope: input.domainScope,
            organizationId,
            userId,
          },
          selectedUserId,
        }),
      );
    },
    [
      input.bindingKey,
      input.canReadLocalProfiles,
      input.domainScope,
      input.organizationId,
      input.selectedUserIdRef,
      input.setState,
      input.userId,
    ],
  );
}

export function useOrgManagerProfileDisplayNames(
  params: OrgManagerProfileDisplayNamesParams,
) {
  const {
    appData,
    canLoadAuthenticatedOrgData,
    directory,
    findRosterProfileContainer,
    selectedUserIdRef,
    subscribeToContainers,
    tearleads,
  } = params;
  const [state, setState] = useState<ProfileDisplayNameState | null>(null);
  const directoryRef = useRef(directory);
  directoryRef.current = directory;
  const organizationId = appData.auth.organizationId;
  const userId = appData.auth.userId;
  const domainScope = appData.state.domainScope;
  const bindingKey = getProfileBindingKey(directory, organizationId);
  // A promotion or demotion changes who may pull, without changing the roster.
  const isOrgAdmin = directory?.currentUser.isOrgAdmin === true;
  const canReadLocalProfiles = Boolean(
    canLoadAuthenticatedOrgData &&
      appData.auth.isAuthenticated &&
      appData.infra.dbStatus === "ready" &&
      organizationId &&
      userId &&
      bindingKey !== "purged",
  );
  useEffect(() => {
    const activeDirectory = directoryRef.current;
    if (
      !canReadLocalProfiles ||
      !organizationId ||
      !userId ||
      !activeDirectory ||
      activeDirectory.organizationId !== organizationId
    ) {
      return;
    }
    return startLocalProfileDisplayNameLoad({
      directory: activeDirectory,
      findRosterProfileContainer,
      isOrgAdmin,
      scope: { bindingKey, domainScope, organizationId, userId },
      setState,
      subscribeToContainers,
      tearleads,
    });
  }, [
    bindingKey,
    canReadLocalProfiles,
    domainScope,
    findRosterProfileContainer,
    isOrgAdmin,
    organizationId,
    subscribeToContainers,
    tearleads,
    userId,
  ]);

  const setSelectedProfileDisplayName = useSelectedProfileDisplayNameSetter({
    bindingKey,
    canReadLocalProfiles,
    domainScope,
    organizationId,
    selectedUserIdRef,
    setState,
    userId,
  });

  const profileDisplayNamesByUserId =
    canReadLocalProfiles &&
    organizationId &&
    userId &&
    matchesScope(state, { bindingKey, domainScope, organizationId, userId })
      ? state.names
      : EMPTY_PROFILE_DISPLAY_NAMES;

  return { profileDisplayNamesByUserId, setSelectedProfileDisplayName };
}
