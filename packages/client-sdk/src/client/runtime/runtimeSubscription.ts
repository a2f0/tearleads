import { createListenerSet } from "../../data/shared/listenerSet";
import { sessionLifetime } from "../session";
import type { Session, SessionSnapshot } from "../session/sessionTypes";

interface Subscribable {
  subscribe(listener: () => void): () => void;
}
interface SubscriptionSources {
  database: Subscribable;
  events: Subscribable;
  identity: Subscribable;
  network: Subscribable;
  session: Session;
  syncBillingGate?: Subscribable | undefined;
}

export function createRuntimeSubscription(dependencies: SubscriptionSources) {
  const listeners = createListenerSet();
  let version = 0;
  let sessionGeneration = 0;
  let recoveryGeneration = 0;
  let mutationGeneration = 0;
  const lifetime = sessionLifetime(dependencies.session);
  let epoch = lifetime.epoch;
  let sessionSnapshot = dependencies.session.snapshot;
  const notifyListeners = () => {
    version += 1;
    listeners.notify();
  };

  const notifyAuthority = () => {
    recoveryGeneration += 1;
    mutationGeneration += 1;
    notifyListeners();
  };
  dependencies.database.subscribe(notifyAuthority);
  dependencies.events.subscribe(notifyListeners);
  dependencies.identity.subscribe(notifyAuthority);
  dependencies.network.subscribe(() => notifyListeners());
  dependencies.session.subscribe(() => {
    const next = dependencies.session.snapshot;
    const replaced = epoch !== lifetime.epoch;
    epoch = lifetime.epoch;
    const changed = replaced || sessionScopeChanged(sessionSnapshot, next);
    if (
      changed ||
      (next.authToken !== sessionSnapshot.authToken &&
        lifetime.lastRenewal !== next)
    ) {
      sessionGeneration += 1;
      recoveryGeneration += 1;
    }
    if (changed) mutationGeneration += 1;
    sessionSnapshot = next;
    notifyListeners();
  });
  dependencies.syncBillingGate?.subscribe(notifyListeners);

  return {
    get mutationGeneration() {
      return mutationGeneration;
    },
    get recoveryGeneration() {
      return recoveryGeneration;
    },
    get sessionGeneration() {
      return sessionGeneration;
    },
    get version() {
      return version;
    },
    subscribe(listener: () => void): () => void {
      return listeners.subscribe(listener);
    },
  };
}

// A transport token renewal cannot turn a definite write refusal into saved work.
// Journal custody still expires on every change to its identity or storage scope.
function sessionScopeChanged(
  previous: SessionSnapshot,
  next: SessionSnapshot,
): boolean {
  return (
    next.isAuthenticated !== previous.isAuthenticated ||
    next.isRoot !== previous.isRoot ||
    next.organizationId !== previous.organizationId ||
    next.userId !== previous.userId
  );
}
