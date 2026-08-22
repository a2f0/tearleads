import { expect, test } from "bun:test";
import { resumeRemoteContainerRecoveryWork } from "./remoteContainerIngestion";

test("recovery hydration waits for queued ingestion to settle", async () => {
  let resolveIngestion: () => void = () => {
    throw new Error("ingestion promise was not initialized");
  };
  let projection = "empty";
  let hydrationStarted = false;

  const recovery = resumeRemoteContainerRecoveryWork({
    onHydrationError: () => {},
    onIngestionError: () => {},
    resumeHydration: async () => {
      hydrationStarted = true;
      projection = "newer-page";
    },
    resumeIngestion: () =>
      new Promise<void>((resolve) => {
        resolveIngestion = () => {
          projection = "older-event";
          resolve();
        };
      }),
  });
  await Bun.sleep(1);

  expect(hydrationStarted).toBe(false);
  resolveIngestion();
  await recovery;

  expect(hydrationStarted).toBe(true);
  expect(projection).toBe("newer-page");
});

test("ingestion retry is followed by deferred recovery hydration", async () => {
  const errors: unknown[] = [];
  let ingestionAttempt = 0;
  let hydrationRan = false;
  const input = {
    onHydrationError: (error: unknown) => errors.push(error),
    onIngestionError: (error: unknown) => errors.push(error),
    resumeHydration: async () => {
      hydrationRan = true;
    },
    resumeIngestion: async () => {
      ingestionAttempt += 1;
      if (ingestionAttempt === 1) {
        throw new Error("ingestion failed");
      }
    },
  };

  await resumeRemoteContainerRecoveryWork(input);

  expect(hydrationRan).toBe(false);
  expect(errors).toHaveLength(1);

  await resumeRemoteContainerRecoveryWork(input);

  expect(hydrationRan).toBe(true);
  expect(errors).toHaveLength(1);
});
