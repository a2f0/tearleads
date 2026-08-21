import type { OrganizationDirectory } from "@symcrypt/client-sdk";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  useSymCrypt,
  useSymCryptRuntime,
} from "../../../providers/sdk/SymCryptProvider";
import {
  getLocalRosterProfileDisplayNames,
  getRosterProfileBindingsByLocalId,
  getRosterProfileDocumentBindingKey,
} from "../../../stores/org-manager/rosterProfileDisplayNames";
import { EMPTY_PROFILE_DISPLAY_NAMES } from "../display";

interface OrgManagerProfileDisplayNamesParams {
  appData: ReturnType<typeof useSymCryptRuntime>;
  canLoadAuthenticatedOrgData: boolean;
  directory: OrganizationDirectory | null;
  selectedUserIdRef: { current: string | null };
  symcrypt: ReturnType<typeof useSymCrypt>;
}

interface ProfileDisplayNameScope {
  readonly bindingKey: string;
  readonly domainScope: ReturnType<
    typeof useSymCryptRuntime
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

function startLocalProfileDisplayNameLoad(input: {
  readonly directory: OrganizationDirectory;
  readonly scope: ProfileDisplayNameScope;
  readonly setState: Dispatch<SetStateAction<ProfileDisplayNameState | null>>;
  readonly symcrypt: ReturnType<typeof useSymCrypt>;
}): (() => void) | undefined {
  const profileBindingsByLocalId = getRosterProfileBindingsByLocalId({
    organizationId: input.scope.organizationId,
    users: input.directory.users,
  });
  if (profileBindingsByLocalId.size === 0) {
    return;
  }
  let cancelled = false;
  let loadSequence = 0;
  const reload = async () => {
    const sequence = ++loadSequence;
    try {
      const documents = await input.symcrypt.documents.list({
        documentKind: "contact",
      });
      const names = getLocalRosterProfileDisplayNames({
        documents,
        profileBindingsByLocalId,
      });
      if (!cancelled && sequence === loadSequence) {
        input.setState({ ...input.scope, names });
      }
    } catch (error) {
      if (!cancelled) {
        input.symcrypt.logError(
          "Failed to load local organization roster display names",
          error,
        );
      }
    }
  };
  const unsubscribe = input.symcrypt.documents.subscribe((document) => {
    if (profileBindingsByLocalId.has(document.id)) {
      void reload();
    }
  });
  void reload();
  return () => {
    cancelled = true;
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
    selectedUserIdRef,
    symcrypt,
  } = params;
  const [state, setState] = useState<ProfileDisplayNameState | null>(null);
  const directoryRef = useRef(directory);
  directoryRef.current = directory;
  const organizationId = appData.auth.organizationId;
  const userId = appData.auth.userId;
  const domainScope = appData.state.domainScope;
  const bindingKey = getProfileBindingKey(directory, organizationId);
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
      scope: { bindingKey, domainScope, organizationId, userId },
      setState,
      symcrypt,
    });
  }, [
    bindingKey,
    canReadLocalProfiles,
    domainScope,
    organizationId,
    symcrypt,
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
