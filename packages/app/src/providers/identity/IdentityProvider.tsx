import type { IdentityKeyPackage } from "@tearleads/client-sdk";
import type { EncapsulationKeyPair, SigningKeyPair } from "@tearleads/crypto";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useTearleads } from "../sdk/TearleadsProvider";
import { useTearleadsStoreSnapshot } from "../sdk/useTearleadsSubscription";
import {
  useDestroyKey,
  useGenerateKey,
  useLocalIdentityPersistence,
  usePersistLocalIdentity,
  useRestoreKeyPackage,
  useRestoreLocalIdentity,
} from "./localIdentityPersistence";

interface IdentityContextValue {
  encapsulationKeyPair: EncapsulationKeyPair | null;
  destroyKey: () => void;
  exportKeyPackage: () => Promise<IdentityKeyPackage>;
  generateKey: () => void;
  restoreKeyPackage: (keyPackage: unknown) => Promise<void>;
  signingFingerprint: string | null;
  signingKeyPair: SigningKeyPair | null;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function IdentityProvider({ children }: PropsWithChildren) {
  const hostConfig = useAppHostConfig();
  const tearleads = useTearleads();
  const generationInFlight = useRef(false);
  const generationIdRef = useRef(0);
  const snapshot = useTearleadsStoreSnapshot(tearleads.identity);
  const localPersistence = useLocalIdentityPersistence({
    createLocalKeyring: hostConfig.createLocalKeyring,
    namespace: hostConfig.localIdentityNamespace ?? null,
  });

  useRestoreLocalIdentity({
    generationIdRef,
    generationInFlight,
    localPersistence,
    signingKeyPair: snapshot.signingKeyPair,
    tearleads,
  });

  const persistLocalIdentity = usePersistLocalIdentity(
    localPersistence,
    tearleads,
  );
  const generateKey = useGenerateKey({
    generationIdRef,
    generationInFlight,
    persistLocalIdentity,
    tearleads,
  });
  const destroyKey = useDestroyKey({
    generationIdRef,
    generationInFlight,
    localPersistence,
    tearleads,
  });

  const exportKeyPackage = useCallback(
    () => tearleads.identity.exportKeyPackage(),
    [tearleads],
  );
  const restoreKeyPackage = useRestoreKeyPackage({
    generationIdRef,
    generationInFlight,
    persistLocalIdentity,
    tearleads,
  });

  const value = useMemo(
    () => ({
      encapsulationKeyPair: snapshot.encapsulationKeyPair,
      destroyKey,
      exportKeyPackage,
      generateKey,
      restoreKeyPackage,
      signingFingerprint: snapshot.signingFingerprint,
      signingKeyPair: snapshot.signingKeyPair,
    }),
    [
      destroyKey,
      exportKeyPackage,
      generateKey,
      restoreKeyPackage,
      snapshot.encapsulationKeyPair,
      snapshot.signingFingerprint,
      snapshot.signingKeyPair,
    ],
  );

  return (
    <IdentityContext.Provider value={value}>
      {children}
    </IdentityContext.Provider>
  );
}

export function useIdentity(): IdentityContextValue {
  const context = useContext(IdentityContext);
  if (!context) {
    throw new Error("useIdentity must be used within an IdentityProvider.");
  }

  return context;
}
