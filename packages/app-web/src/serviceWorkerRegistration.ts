const SERVICE_WORKER_URL = "/sw.js";
const CONTROLLED_UPDATE_TIMEOUT_MS = 1_500;

function canUseServiceWorker(): boolean {
  return (
    !import.meta.hot &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator
  );
}

function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(SERVICE_WORKER_URL);
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = globalThis.setTimeout(() => resolve(null), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) {
      globalThis.clearTimeout(timeoutId);
    }
  });
}

function waitForWorkerActivation(
  worker: ServiceWorker | null,
  timeoutMs: number,
): Promise<void> {
  if (!worker || worker.state === "activated" || worker.state === "redundant") {
    return Promise.resolve();
  }

  const pendingWorker = worker;

  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = globalThis.setTimeout(finish, timeoutMs);

    function finish() {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.clearTimeout(timeoutId);
      pendingWorker.removeEventListener("statechange", handleStateChange);
      resolve();
    }

    function handleStateChange() {
      if (
        pendingWorker.state === "activated" ||
        pendingWorker.state === "redundant"
      ) {
        finish();
      }
    }

    pendingWorker.addEventListener("statechange", handleStateChange);
    handleStateChange();
  });
}

async function updateControllingServiceWorker(): Promise<void> {
  try {
    const registration = await withTimeout(
      registerServiceWorker(),
      CONTROLLED_UPDATE_TIMEOUT_MS,
    );
    const updatedRegistration = registration
      ? await withTimeout(registration.update(), CONTROLLED_UPDATE_TIMEOUT_MS)
      : null;
    await waitForWorkerActivation(
      updatedRegistration?.installing ?? updatedRegistration?.waiting ?? null,
      CONTROLLED_UPDATE_TIMEOUT_MS,
    );
  } catch {
    // The app works online without the service worker. A failed update only
    // risks stale/offline assets, so do not block startup.
  }
}

export async function prepareControllingServiceWorker(): Promise<void> {
  if (!canUseServiceWorker() || !navigator.serviceWorker.controller) {
    return;
  }

  await updateControllingServiceWorker();
}

export function registerServiceWorkerAfterLoad(): void {
  if (!canUseServiceWorker()) {
    return;
  }

  const register = () => {
    registerServiceWorker().catch(() => {
      // The app works online without the service worker; only offline support is
      // lost if registration fails.
    });
  };

  if (typeof document !== "undefined" && document.readyState === "complete") {
    register();
  } else {
    globalThis.addEventListener("load", register);
  }
}
