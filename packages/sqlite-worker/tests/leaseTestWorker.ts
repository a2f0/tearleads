import { createDatabaseWorkerConnectionFactory } from "../src/databaseConnections";
import { registerDatabaseWorker } from "../src/worker";

// The real worker, with the lease's bounds taken from the environment the
// test gives the worker, so a test can shorten them. Revocation logs are
// posted to the worker object, which the cross-tab owner does not listen to.
const { LEASE_TEST_IDLE_MS, LEASE_TEST_WAIT_MS } = process.env;
const idleMs = Number(LEASE_TEST_IDLE_MS);
const waitMs = Number(LEASE_TEST_WAIT_MS);

registerDatabaseWorker(
  createDatabaseWorkerConnectionFactory({
    leaseBounds: {
      ...(Number.isFinite(idleMs) ? { idleMs } : {}),
      ...(Number.isFinite(waitMs) ? { waitMs } : {}),
    },
    log: (message) => {
      postMessage({ type: "lease-test-log", message });
    },
  }),
);
