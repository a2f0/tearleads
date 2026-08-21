import type { OrganizationDirectoryAndGroups } from "@symcrypt/client-sdk";
import { useEffect, useRef, useState } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/SymCryptProvider";
import { useSymCrypt } from "../../../providers/sdk/SymCryptProvider";
import {
  getExplorerAttributionProfileBindingsByLocalId,
  getExplorerAttributionProfileDisplayNames,
  getExplorerAttributionProjectionKey,
  loadExplorerAttributionDirectoryAndGroups,
} from "./explorerAttributionReadModel";

type SymCryptRuntime = ReturnType<typeof useSymCrypt>;

const EMPTY_PROFILE_DISPLAY_NAMES: ReadonlyMap<string, string> = new Map();

interface ProfileDisplayNameState {
  readonly domainScope: RuntimeSnapshot["state"]["domainScope"];
  readonly names: ReadonlyMap<string, string>;
  readonly organizationId: string;
  readonly projectionKey: string;
  readonly userId: string;
}

async function loadLocalProfileDisplayNames(input: {
  documents: SymCryptRuntime["documents"];
  profileBindingsByLocalId: ReturnType<
    typeof getExplorerAttributionProfileBindingsByLocalId
  >;
}): Promise<ReadonlyMap<string, string>> {
  const documents = await input.documents.list({ documentKind: "contact" });
  return getExplorerAttributionProfileDisplayNames({
    documents,
    profileBindingsByLocalId: input.profileBindingsByLocalId,
  });
}

function startProfileDisplayNameLoad(input: {
  directoryAndGroups?: OrganizationDirectoryAndGroups | null | undefined;
  organizationId: string;
  setNames: (names: ReadonlyMap<string, string>) => void;
  symcrypt: SymCryptRuntime;
}): () => void {
  let cancelled = false;
  let loadSequence = 0;
  let unsubscribe: () => void = () => undefined;
  const reportFailure = (error: unknown) => {
    if (!cancelled) {
      input.symcrypt.logError(
        "Failed to load local explorer attribution roster display names",
        error,
      );
    }
  };

  void loadExplorerAttributionDirectoryAndGroups(
    input.symcrypt.organizations,
    input.directoryAndGroups,
  )
    .then((directoryAndGroups) => {
      if (cancelled || !directoryAndGroups) {
        return;
      }
      const profileBindingsByLocalId =
        getExplorerAttributionProfileBindingsByLocalId({
          directoryAndGroups,
          organizationId: input.organizationId,
        });
      if (profileBindingsByLocalId.size === 0) {
        return;
      }

      const reload = async () => {
        const sequence = ++loadSequence;
        try {
          const next = await loadLocalProfileDisplayNames({
            documents: input.symcrypt.documents,
            profileBindingsByLocalId,
          });
          if (!cancelled && sequence === loadSequence) {
            input.setNames(next);
          }
        } catch (error) {
          reportFailure(error);
        }
      };
      unsubscribe = input.symcrypt.documents.subscribe((document) => {
        if (profileBindingsByLocalId.has(document.id)) {
          void reload();
        }
      });
      void reload();
    })
    .catch(reportFailure);

  return () => {
    cancelled = true;
    loadSequence += 1;
    unsubscribe();
  };
}

export function useExplorerAttributionProfileDisplayNames(input: {
  readonly appData: RuntimeSnapshot;
  readonly enabled: boolean;
  readonly readModelProjection?:
    | OrganizationDirectoryAndGroups
    | null
    | undefined;
  readonly readModelRevision?: number | undefined;
}) {
  const symcrypt = useSymCrypt();
  const [state, setState] = useState<ProfileDisplayNameState | null>(null);
  const projectionRef = useRef<OrganizationDirectoryAndGroups | null>(null);
  projectionRef.current = input.readModelProjection ?? null;
  const projectionKey = getExplorerAttributionProjectionKey({
    projection: input.readModelProjection,
    revision: input.readModelRevision ?? 0,
  });
  const { isAuthenticated, organizationId, userId } = input.appData.auth;
  const dbStatus = input.appData.infra.dbStatus;
  const domainScope = input.appData.state.domainScope;

  useEffect(() => {
    setState(null);
  }, [
    dbStatus,
    domainScope,
    input.enabled,
    isAuthenticated,
    organizationId,
    projectionKey,
    userId,
  ]);

  useEffect(() => {
    if (
      !input.enabled ||
      !isAuthenticated ||
      !organizationId ||
      !userId ||
      dbStatus !== "ready"
    ) {
      return;
    }
    return startProfileDisplayNameLoad({
      directoryAndGroups:
        projectionKey === "local" ? undefined : projectionRef.current,
      organizationId,
      setNames: (names) => {
        setState({
          domainScope,
          names,
          organizationId,
          projectionKey,
          userId,
        });
      },
      symcrypt,
    });
  }, [
    dbStatus,
    domainScope,
    input.enabled,
    isAuthenticated,
    organizationId,
    projectionKey,
    symcrypt,
    userId,
  ]);

  if (
    !input.enabled ||
    !isAuthenticated ||
    !organizationId ||
    !userId ||
    dbStatus !== "ready" ||
    state?.domainScope !== domainScope ||
    state.organizationId !== organizationId ||
    state.userId !== userId ||
    state.projectionKey !== projectionKey
  ) {
    return EMPTY_PROFILE_DISPLAY_NAMES;
  }
  return state.names;
}
