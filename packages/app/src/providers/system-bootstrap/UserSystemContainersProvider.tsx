import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";
import {
  deriveUserSystemContainers,
  type SystemContainerScope,
  type UserSystemContainer,
} from "../../stores/systemContainers";
import { useAsyncDerivedState } from "../../utils/useAsyncDerivedState";
import { useTearleads, useTearleadsRuntime } from "../sdk/TearleadsProvider";

const UserSystemContainersContext =
  createContext<ReadonlyArray<UserSystemContainer> | null>(null);

const EMPTY: ReadonlyArray<UserSystemContainer> = [];
const emptyResult = () => null;

async function deriveScopedContainers(scope: SystemContainerScope) {
  return { scope, containers: await deriveUserSystemContainers(scope) };
}

export function UserSystemContainersProvider({ children }: PropsWithChildren) {
  const runtime = useTearleadsRuntime();
  const tearleads = useTearleads();
  const signingPrivateKey = runtime.crypto.signingKeyPair?.signingPrivateKey;
  const organizationId = runtime.auth.organizationId;
  const rootContainerId = runtime.state.containerId;
  const scope = useMemo(
    () =>
      signingPrivateKey
        ? { signingPrivateKey, organizationId, rootContainerId }
        : null,
    [signingPrivateKey, organizationId, rootContainerId],
  );
  const result = useAsyncDerivedState({
    createEmptyValue: emptyResult,
    derive: deriveScopedContainers,
    errorMessage: "Failed to derive system bootstrap slots",
    logError: tearleads.logError,
    source: scope,
  });
  const systemContainers =
    result && result.scope === scope ? result.containers : EMPTY;

  return (
    <UserSystemContainersContext.Provider value={systemContainers}>
      {children}
    </UserSystemContainersContext.Provider>
  );
}

export function useUserSystemContainers(): ReadonlyArray<UserSystemContainer> {
  const systemContainers = useContext(UserSystemContainersContext);
  if (!systemContainers) {
    throw new Error(
      "useUserSystemContainers must be used within a UserSystemContainersProvider.",
    );
  }

  return systemContainers;
}
