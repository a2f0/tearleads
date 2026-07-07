import type { IdentityKeyPackage } from "@tearleads/client-sdk";
import type { EncapsulationKeyPair, SigningKeyPair } from "@tearleads/crypto";
import {
  createContext,
  type MutableRefObject,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";
import { useDatabase } from "../db/DatabaseProvider";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useLocalKeyringLock } from "../local-keyring/LocalKeyringLockProvider";
import { useTearleads } from "../sdk/TearleadsProvider";
import { useTearleadsStoreSnapshot } from "../sdk/useTearleadsSubscription";
import { useGenerateKey } from "./localIdentityGeneration";
import {
  useDestroyKey,
  useLocalIdentityPersistence,
  useLocalIdentityRestore,
  usePersistLocalIdentity,
  useRestoreKeyPackage,
} from "./localIdentityPersistence";
import { useRestoreSeedPhrase } from "./localIdentitySeedPhraseRestore";

export interface IdentityContextValue {
  encapsulationKeyPair: EncapsulationKeyPair | null;
  destroyKey: () => void;
  exportKeyPackage: () => Promise<IdentityKeyPackage>;
  generateKey: () => Promise<boolean>;
  /**
   * Whether the user has explicitly destroyed the identity this session. The
   * autopilot stops auto-generating once this is set, so "Destroy Key Pair"
   * actually leaves the app keyless instead of being immediately re-provisioned;
   * it resets on reload (a fresh boot auto-provisions again).
   */
  identityDestroyed: boolean;
  /**
   * Whether the initial attempt to restore a persisted local identity has
   * settled. `false` until the first restore finishes (or there is nothing to
   * restore); consumers like the identity autopilot wait for this so they do
   * not generate a fresh identity over one that is still loading.
   */
  localIdentityRestoreSettled: boolean;
  localIdentityRestoredFingerprint: string | null;
  restoreKeyPackage: (keyPackage: unknown) => Promise<void>;
  restoreSeedPhrase: (seedPhrase: string) => Promise<void>;
  seedPhrase: string | null;
  signingFingerprint: string | null;
  signingKeyPair: SigningKeyPair | null;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

function useIdentityProviderActions(input: {
  readonly clearDatabase: () => void;
  readonly ensureIdentityDatabaseReady: (
    signingFingerprint: string,
  ) => Promise<void>;
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly localPersistence: ReturnType<typeof useLocalIdentityPersistence>;
  readonly tearleads: ReturnType<typeof useTearleads>;
}) {
  const {
    clearDatabase,
    ensureIdentityDatabaseReady,
    generationIdRef,
    generationInFlight,
    localPersistence,
    tearleads,
  } = input;
  const persistLocalIdentity = usePersistLocalIdentity(
    localPersistence,
    tearleads,
  );
  const generateKey = useGenerateKey({
    ensureIdentityDatabaseReady,
    generationIdRef,
    generationInFlight,
    persistLocalIdentity,
    tearleads,
  });
  const { destroyKey, identityDestroyed } = useDestroyKey({
    clearDatabase,
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
  const restoreSeedPhrase = useRestoreSeedPhrase({
    ensureIdentityDatabaseReady,
    generationIdRef,
    generationInFlight,
    persistLocalIdentity,
    tearleads,
  });

  return {
    destroyKey,
    exportKeyPackage,
    generateKey,
    identityDestroyed,
    restoreKeyPackage,
    restoreSeedPhrase,
  };
}

export function IdentityProvider({ children }: PropsWithChildren) {
  const hostConfig = useAppHostConfig();
  const {
    clearWorker: clearDatabase,
    ensureIdentityReady: ensureIdentityDatabaseReady,
  } = useDatabase();
  const tearleads = useTearleads();
  const localKeyringLock = useLocalKeyringLock();
  const generationInFlight = useRef(false);
  const generationIdRef = useRef(0);
  const snapshot = useTearleadsStoreSnapshot(tearleads.identity);
  const localPersistence = useLocalIdentityPersistence({
    createLocalKeyring: localKeyringLock.createLocalKeyring,
    namespace: localKeyringLock.isLocked
      ? null
      : (hostConfig.localIdentityNamespace ?? null),
  });
  const {
    restoredFingerprint: localIdentityRestoredFingerprint,
    restoreSettled: localIdentityRestoreSettled,
  } = useLocalIdentityRestore({
    generationIdRef,
    generationInFlight,
    localPersistence,
    signingKeyPair: snapshot.signingKeyPair,
    tearleads,
  });
  const identityActions = useIdentityProviderActions({
    clearDatabase,
    ensureIdentityDatabaseReady,
    generationIdRef,
    generationInFlight,
    localPersistence,
    tearleads,
  });

  const value = useMemo(
    () => ({
      encapsulationKeyPair: snapshot.encapsulationKeyPair,
      destroyKey: identityActions.destroyKey,
      exportKeyPackage: identityActions.exportKeyPackage,
      generateKey: identityActions.generateKey,
      identityDestroyed: identityActions.identityDestroyed,
      localIdentityRestoreSettled,
      localIdentityRestoredFingerprint,
      restoreKeyPackage: identityActions.restoreKeyPackage,
      restoreSeedPhrase: identityActions.restoreSeedPhrase,
      seedPhrase: snapshot.seedPhrase,
      signingFingerprint: snapshot.signingFingerprint,
      signingKeyPair: snapshot.signingKeyPair,
    }),
    [
      identityActions.destroyKey,
      identityActions.exportKeyPackage,
      identityActions.generateKey,
      identityActions.identityDestroyed,
      identityActions.restoreKeyPackage,
      identityActions.restoreSeedPhrase,
      localIdentityRestoreSettled,
      localIdentityRestoredFingerprint,
      snapshot.encapsulationKeyPair,
      snapshot.seedPhrase,
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
