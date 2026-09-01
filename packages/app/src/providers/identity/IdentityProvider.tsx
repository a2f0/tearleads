import type { IdentitySnapshot } from "@tearleads/client-sdk";
import type { EncapsulationKeyPair, SigningKeyPair } from "@tearleads/crypto";
import {
  createContext,
  type MutableRefObject,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clearPersistedCryptoSessionForIdentity,
  queueCryptoSessionPersistence,
  useLocalCryptoSessionPersistence,
} from "../crypto/localCryptoSessionPersistence";
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
import type { LocalIdentitySummary } from "./localIdentityRegistry";
import { useRestoreSeedPhrase } from "./localIdentitySeedPhraseRestore";
import {
  useCreateLocalIdentity,
  useImportLocalIdentity,
  useSwitchLocalIdentity,
} from "./localIdentitySwitching";

export interface IdentityContextValue {
  createIdentity: () => Promise<boolean>;
  encapsulationKeyPair: EncapsulationKeyPair | null;
  destroyKey: () => void;
  generateKey: () => Promise<boolean>;
  /**
   * Whether the user has explicitly destroyed the identity this session. The
   * autopilot stops auto-generating once this is set, so "Destroy Key Pair"
   * actually leaves the app keyless instead of being immediately re-provisioned;
   * it resets on reload (a fresh boot auto-provisions again).
   */
  identityDestroyed: boolean;
  identityTransitionInFlight: boolean;
  localIdentities: readonly LocalIdentitySummary[];
  localIdentitySwitchingAvailable: boolean;
  /**
   * Whether the initial attempt to restore a persisted local identity has
   * settled. `false` until the first restore finishes (or there is nothing to
   * restore); consumers like the identity autopilot wait for this so they do
   * not generate a fresh identity over one that is still loading.
   */
  localIdentityRestoreSettled: boolean;
  localIdentityRestoredFingerprint: string | null;
  /** Flushes the current SDK session to encrypted local persistence. */
  persistSession: () => Promise<boolean>;
  restoreKeyPackage: (keyPackage: unknown) => Promise<void>;
  restoreSeedPhrase: (seedPhrase: string) => Promise<void>;
  seedPhrase: string | null;
  signingFingerprint: string | null;
  signingKeyPair: SigningKeyPair | null;
  switchIdentity: (signingFingerprint: string) => Promise<boolean>;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

interface IdentityProviderActionsInput {
  /** Closes the database. A capable native host retains its physical worker. */
  readonly clearDatabase: () => void;
  /**
   * Close the current database ahead of a transition to a different one while
   * keeping a healthy physical worker alive under host reuse.
   */
  readonly clearDatabaseForIdentitySwitch: () => void;
  readonly ensureIdentityDatabaseReady: (
    signingFingerprint: string,
  ) => Promise<void>;
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly localPersistence: ReturnType<typeof useLocalIdentityPersistence>;
  readonly localIdentityNamespace: string | null;
  readonly onIdentitiesChanged: (
    identities: readonly LocalIdentitySummary[],
  ) => void;
  readonly persistSessionBeforeIdentityTransition: () => Promise<void>;
  readonly setTransitionInFlight: (inFlight: boolean) => void;
  readonly tearleads: ReturnType<typeof useTearleads>;
  readonly transitionInFlightRef: MutableRefObject<boolean>;
}

function useLocalIdentitySwitcherActions(
  input: IdentityProviderActionsInput & {
    readonly generateKey: () => Promise<boolean>;
  },
) {
  const identityTransitionInput = {
    clearDatabase: input.clearDatabaseForIdentitySwitch,
    ensureIdentityDatabaseReady: input.ensureIdentityDatabaseReady,
    generationIdRef: input.generationIdRef,
    generationInFlight: input.generationInFlight,
    localPersistence: input.localPersistence,
    onIdentitiesChanged: input.onIdentitiesChanged,
    persistSessionBeforeIdentityTransition:
      input.persistSessionBeforeIdentityTransition,
    setTransitionInFlight: input.setTransitionInFlight,
    tearleads: input.tearleads,
    transitionInFlightRef: input.transitionInFlightRef,
  };
  const switchIdentity = useSwitchLocalIdentity(identityTransitionInput);
  const importIdentityPackage = useImportLocalIdentity(identityTransitionInput);
  const createIdentity = useCreateLocalIdentity({
    clearDatabase: input.clearDatabaseForIdentitySwitch,
    generateKey: input.generateKey,
    generationInFlight: input.generationInFlight,
    persistSessionBeforeIdentityTransition:
      input.persistSessionBeforeIdentityTransition,
    setTransitionInFlight: input.setTransitionInFlight,
    switchIdentity,
    tearleads: input.tearleads,
    transitionInFlightRef: input.transitionInFlightRef,
  });
  return useMemo(
    () => ({ createIdentity, importIdentityPackage, switchIdentity }),
    [createIdentity, importIdentityPackage, switchIdentity],
  );
}

function useIdentityProviderActions(input: IdentityProviderActionsInput) {
  const {
    clearDatabase,
    ensureIdentityDatabaseReady,
    generationIdRef,
    generationInFlight,
    localPersistence,
    localIdentityNamespace,
    onIdentitiesChanged,
    tearleads,
  } = input;
  const persistLocalIdentity = usePersistLocalIdentity(
    localPersistence,
    onIdentitiesChanged,
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
    onIdentitiesChanged,
    onIdentityRemoved: (signingFingerprint) =>
      clearPersistedCryptoSessionForIdentity({
        namespace: localIdentityNamespace,
        signingFingerprint,
      }),
    tearleads,
  });

  const { createIdentity, importIdentityPackage, switchIdentity } =
    useLocalIdentitySwitcherActions({ ...input, generateKey });
  const restoreKeyPackage = useRestoreKeyPackage({ importIdentityPackage });
  const restoreSeedPhrase = useRestoreSeedPhrase({ restoreKeyPackage });

  return useMemo(
    () => ({
      createIdentity,
      destroyKey,
      generateKey,
      identityDestroyed,
      restoreKeyPackage,
      restoreSeedPhrase,
      switchIdentity,
    }),
    [
      createIdentity,
      destroyKey,
      generateKey,
      identityDestroyed,
      restoreKeyPackage,
      restoreSeedPhrase,
      switchIdentity,
    ],
  );
}

function useIdentityContextValue(input: {
  readonly identityActions: ReturnType<typeof useIdentityProviderActions>;
  readonly identityTransitionInFlight: boolean;
  readonly localIdentities: readonly LocalIdentitySummary[];
  readonly localIdentityRestoreSettled: boolean;
  readonly localIdentityRestoredFingerprint: string | null;
  readonly localPersistence: ReturnType<typeof useLocalIdentityPersistence>;
  readonly persistSession: () => Promise<boolean>;
  readonly snapshot: IdentitySnapshot;
}): IdentityContextValue {
  const {
    identityActions,
    identityTransitionInFlight,
    localIdentities,
    localIdentityRestoreSettled,
    localIdentityRestoredFingerprint,
    localPersistence,
    persistSession,
    snapshot,
  } = input;
  return useMemo(
    () => ({
      createIdentity: identityActions.createIdentity,
      encapsulationKeyPair: snapshot.encapsulationKeyPair,
      destroyKey: identityActions.destroyKey,
      generateKey: identityActions.generateKey,
      identityDestroyed: identityActions.identityDestroyed,
      identityTransitionInFlight,
      localIdentities,
      localIdentityRestoreSettled,
      localIdentityRestoredFingerprint,
      localIdentitySwitchingAvailable: localPersistence !== null,
      persistSession,
      restoreKeyPackage: identityActions.restoreKeyPackage,
      restoreSeedPhrase: identityActions.restoreSeedPhrase,
      seedPhrase: snapshot.seedPhrase,
      signingFingerprint: snapshot.signingFingerprint,
      signingKeyPair: snapshot.signingKeyPair,
      switchIdentity: identityActions.switchIdentity,
    }),
    [
      identityActions,
      identityTransitionInFlight,
      localIdentities,
      localIdentityRestoreSettled,
      localIdentityRestoredFingerprint,
      localPersistence,
      persistSession,
      snapshot,
    ],
  );
}

function usePersistCurrentSession(input: {
  readonly localPersistence: ReturnType<
    typeof useLocalCryptoSessionPersistence
  >;
  readonly signingFingerprint: string | null;
  readonly tearleads: ReturnType<typeof useTearleads>;
}): () => Promise<boolean> {
  const {
    localPersistence,
    signingFingerprint: expectedFingerprint,
    tearleads,
  } = input;
  return useCallback(async () => {
    const signingFingerprint = tearleads.identity.signingFingerprint;
    if (
      !signingFingerprint ||
      signingFingerprint !== expectedFingerprint ||
      !localPersistence
    ) {
      return false;
    }
    while (tearleads.identity.signingFingerprint === signingFingerprint) {
      const sessionSnapshot = tearleads.session.snapshot;
      const persisted = await queueCryptoSessionPersistence({
        context: { ...sessionSnapshot },
        localPersistence,
        signingFingerprint,
      });
      if (tearleads.session.snapshot === sessionSnapshot) {
        return persisted;
      }
    }
    return false;
  }, [expectedFingerprint, localPersistence, tearleads]);
}

export function IdentityProvider({ children }: PropsWithChildren) {
  const hostConfig = useAppHostConfig();
  const {
    clearWorker: clearDatabase,
    clearWorkerForIdentitySwitch: clearDatabaseForIdentitySwitch,
    ensureIdentityReady: ensureIdentityDatabaseReady,
  } = useDatabase();
  const tearleads = useTearleads();
  const localKeyringLock = useLocalKeyringLock();
  const generationInFlight = useRef(false);
  const generationIdRef = useRef(0);
  const transitionInFlightRef = useRef(false);
  const [identityTransitionInFlight, setIdentityTransitionInFlight] =
    useState(false);
  const snapshot = useTearleadsStoreSnapshot(tearleads.identity);
  const localPersistence = useLocalIdentityPersistence({
    createLocalKeyring: localKeyringLock.createLocalKeyring,
    namespace: localKeyringLock.isLocked
      ? null
      : (hostConfig.localIdentityNamespace ?? null),
  });
  const localSessionPersistence = useLocalCryptoSessionPersistence({
    createLocalKeyring: localKeyringLock.createLocalKeyring,
    namespace: localKeyringLock.isLocked
      ? null
      : (hostConfig.localIdentityNamespace ?? null),
    signingFingerprint: snapshot.signingFingerprint,
  });
  const persistCurrentSession = usePersistCurrentSession({
    localPersistence: localSessionPersistence,
    signingFingerprint: snapshot.signingFingerprint,
    tearleads,
  });
  const persistSessionBeforeIdentityTransition = useCallback(async () => {
    await persistCurrentSession();
  }, [persistCurrentSession]);
  const {
    identities: localIdentities,
    restoredFingerprint: localIdentityRestoredFingerprint,
    restoreSettled: localIdentityRestoreSettled,
    setIdentities,
  } = useLocalIdentityRestore({
    generationIdRef,
    generationInFlight,
    localPersistence,
    tearleads,
  });
  const identityActions = useIdentityProviderActions({
    clearDatabase,
    clearDatabaseForIdentitySwitch,
    ensureIdentityDatabaseReady,
    generationIdRef,
    generationInFlight,
    localPersistence,
    localIdentityNamespace: hostConfig.localIdentityNamespace ?? null,
    onIdentitiesChanged: setIdentities,
    persistSessionBeforeIdentityTransition,
    setTransitionInFlight: setIdentityTransitionInFlight,
    tearleads,
    transitionInFlightRef,
  });

  const value = useIdentityContextValue({
    identityActions,
    identityTransitionInFlight,
    localIdentities,
    localIdentityRestoreSettled,
    localIdentityRestoredFingerprint,
    localPersistence,
    persistSession: persistCurrentSession,
    snapshot,
  });

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
