import { createContext, type PropsWithChildren, useContext } from "react";
import {
  deriveUserSystemContainers,
  type UserSystemContainer,
} from "../../stores/systemContainers";
import { useAsyncDerivedState } from "../../utils/useAsyncDerivedState";
import { useSymCrypt, useSymCryptRuntime } from "../sdk/SymCryptProvider";

const UserSystemContainersContext =
  createContext<ReadonlyArray<UserSystemContainer> | null>(null);

const createEmptySystemContainers =
  (): ReadonlyArray<UserSystemContainer> => [];

export function UserSystemContainersProvider({ children }: PropsWithChildren) {
  const runtime = useSymCryptRuntime();
  const symcrypt = useSymCrypt();
  const systemContainers = useAsyncDerivedState({
    createEmptyValue: createEmptySystemContainers,
    derive: deriveUserSystemContainers,
    errorMessage: "Failed to derive system bootstrap slots",
    logError: symcrypt.logError,
    source: runtime.crypto.signingKeyPair?.signingPrivateKey ?? null,
  });

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
