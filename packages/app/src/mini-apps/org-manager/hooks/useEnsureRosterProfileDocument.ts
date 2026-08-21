import type {
  DomainScope,
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationUserDetail,
} from "@symcrypt/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { useSymCryptRuntime } from "../../../providers/sdk/SymCryptProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { setUnknownError } from "../refresh";

interface EnsureRosterProfileDocumentParams {
  appData: ReturnType<typeof useSymCryptRuntime>;
  canLoadAuthenticatedOrgData: boolean;
  canUpdateSelectedRosterEntry: boolean;
  domainScope: DomainScope;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  scopeKey: string;
  selectedRosterUser: OrganizationDirectoryUser | null;
  selectedUserIdRef: { current: string | null };
  setDirectory: Dispatch<SetStateAction<OrganizationDirectory | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setMutating: Dispatch<SetStateAction<boolean>>;
  setUserDetail: Dispatch<SetStateAction<OrganizationUserDetail | null>>;
}

type EnsureRosterProfileDocument = ReturnType<
  typeof useOrgManagerActions
>["ensureRosterProfileDocument"];
const pendingProfileDocuments = new WeakMap<
  DomainScope,
  Map<
    string,
    {
      ensureDocument: EnsureRosterProfileDocument;
      promise: Promise<OrganizationDirectoryUser | null>;
    }
  >
>();

function ensureRosterProfileDocumentOnce(
  domainScope: DomainScope,
  ensureDocument: EnsureRosterProfileDocument,
  key: string,
  targetUser: OrganizationDirectoryUser,
): Promise<OrganizationDirectoryUser | null> {
  let pendingByKey = pendingProfileDocuments.get(domainScope);
  if (!pendingByKey) {
    pendingByKey = new Map();
    pendingProfileDocuments.set(domainScope, pendingByKey);
  }
  const existing = pendingByKey.get(key);
  if (existing) {
    if (existing.ensureDocument === ensureDocument) {
      return existing.promise;
    }
    return existing.promise.then(
      (updatedUser) =>
        updatedUser ??
        ensureRosterProfileDocumentOnce(
          domainScope,
          ensureDocument,
          key,
          targetUser,
        ),
      () =>
        ensureRosterProfileDocumentOnce(
          domainScope,
          ensureDocument,
          key,
          targetUser,
        ),
    );
  }

  const promise = ensureDocument(targetUser);
  pendingByKey.set(key, { ensureDocument, promise });
  const cleanup = () => {
    if (pendingByKey?.get(key)?.promise === promise) {
      pendingByKey.delete(key);
    }
  };
  void promise.then(cleanup, cleanup);
  return promise;
}

function useUpdateRosterUserState(
  setDirectory: Dispatch<SetStateAction<OrganizationDirectory | null>>,
  setUserDetail: Dispatch<SetStateAction<OrganizationUserDetail | null>>,
) {
  return useCallback(
    (updatedUser: OrganizationDirectoryUser) => {
      setDirectory((current) =>
        current
          ? {
              ...current,
              users: current.users.map((user) =>
                user.userId === updatedUser.userId ? updatedUser : user,
              ),
            }
          : current,
      );
      setUserDetail((current) =>
        current?.user.userId === updatedUser.userId
          ? { ...current, user: updatedUser }
          : current,
      );
    },
    [setDirectory, setUserDetail],
  );
}

interface ProfileCreationContext extends EnsureRosterProfileDocumentParams {
  readonly cancelled: { current: boolean };
  readonly committedScopeKeyRef: { current: string | null };
  readonly creationKey: string;
  readonly creationKeysRef: { current: Map<string, symbol> };
  readonly operationToken: symbol;
  readonly pendingKey: string;
  readonly selectedRosterUser: OrganizationDirectoryUser;
  readonly updateRosterUserState: (user: OrganizationDirectoryUser) => void;
}

function releaseProfileCreation(context: ProfileCreationContext): void {
  if (
    context.creationKeysRef.current.get(context.creationKey) ===
    context.operationToken
  ) {
    context.creationKeysRef.current.delete(context.creationKey);
  }
}

function observeProfileCreation(context: ProfileCreationContext): void {
  void ensureRosterProfileDocumentOnce(
    context.domainScope,
    context.orgManagerActions.ensureRosterProfileDocument,
    context.pendingKey,
    context.selectedRosterUser,
  )
    .then((updatedUser) => {
      if (context.cancelled.current) {
        return;
      }
      if (!updatedUser) {
        if (
          context.selectedUserIdRef.current ===
          context.selectedRosterUser.userId
        ) {
          context.setError(ORG_MANAGER_LABELS.failedCreateProfileDocument);
        }
        return;
      }
      context.updateRosterUserState(updatedUser);
    })
    .catch((error: unknown) => {
      if (
        !context.cancelled.current &&
        context.selectedUserIdRef.current === context.selectedRosterUser.userId
      ) {
        setUnknownError(context.setError, error);
      }
    })
    .finally(() => {
      releaseProfileCreation(context);
      if (
        !context.cancelled.current &&
        context.creationKeysRef.current.size === 0
      ) {
        context.setMutating(false);
      }
    });
}

function startProfileCreation(
  input: EnsureRosterProfileDocumentParams & {
    committedScopeKeyRef: { current: string | null };
    creationKeysRef: { current: Map<string, symbol> };
    updateRosterUserState: (user: OrganizationDirectoryUser) => void;
  },
): (() => void) | undefined {
  const { selectedRosterUser } = input;
  if (
    !selectedRosterUser ||
    selectedRosterUser.profileDocumentId ||
    !input.canLoadAuthenticatedOrgData ||
    !input.canUpdateSelectedRosterEntry ||
    !input.appData.auth.organizationId ||
    !input.appData.state.containerId
  ) {
    return;
  }

  const creationKey = `${input.scopeKey}:${selectedRosterUser.userId}`;
  if (input.creationKeysRef.current.has(creationKey)) {
    return;
  }
  const operationToken = Symbol(creationKey);
  input.creationKeysRef.current.set(creationKey, operationToken);
  input.setMutating(true);
  input.setError(null);
  const context: ProfileCreationContext = {
    ...input,
    cancelled: { current: false },
    creationKey,
    operationToken,
    pendingKey: `${input.appData.auth.organizationId}:${input.appData.state.containerId}:${selectedRosterUser.userId}`,
    selectedRosterUser,
  };
  observeProfileCreation(context);

  return () => {
    if (input.committedScopeKeyRef.current === input.scopeKey) {
      return;
    }
    context.cancelled.current = true;
    releaseProfileCreation(context);
    if (input.creationKeysRef.current.size === 0) {
      input.setMutating(false);
    }
  };
}

export function useEnsureRosterProfileDocument(
  params: EnsureRosterProfileDocumentParams,
) {
  const {
    appData,
    canLoadAuthenticatedOrgData,
    canUpdateSelectedRosterEntry,
    domainScope,
    orgManagerActions,
    scopeKey,
    selectedRosterUser,
    selectedUserIdRef,
    setDirectory,
    setError,
    setMutating,
    setUserDetail,
  } = params;
  const profileDocumentCreationKeysRef = useRef<Map<string, symbol>>(new Map());
  const committedScopeKeyRef = useRef<string | null>(scopeKey);
  useLayoutEffect(() => {
    committedScopeKeyRef.current = scopeKey;
    return () => {
      if (committedScopeKeyRef.current === scopeKey) {
        committedScopeKeyRef.current = null;
      }
    };
  }, [scopeKey]);
  const updateRosterUserState = useUpdateRosterUserState(
    setDirectory,
    setUserDetail,
  );

  useEffect(
    () =>
      startProfileCreation({
        ...params,
        committedScopeKeyRef,
        creationKeysRef: profileDocumentCreationKeysRef,
        updateRosterUserState,
      }),
    [
      appData.auth.organizationId,
      appData.state.containerId,
      canLoadAuthenticatedOrgData,
      canUpdateSelectedRosterEntry,
      domainScope,
      orgManagerActions,
      scopeKey,
      selectedRosterUser,
      selectedUserIdRef,
      setError,
      setMutating,
      updateRosterUserState,
    ],
  );
}
