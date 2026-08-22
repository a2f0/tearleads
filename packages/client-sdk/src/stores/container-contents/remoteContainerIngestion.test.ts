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

test("ingestion failure does not prevent recovery hydration", async () => {
  const errors: unknown[] = [];
  let hydrationRan = false;

  await resumeRemoteContainerRecoveryWork({
    onHydrationError: (error) => errors.push(error),
    onIngestionError: (error) => errors.push(error),
    resumeHydration: async () => {
      hydrationRan = true;
    },
    resumeIngestion: async () => {
      throw new Error("ingestion failed");
    },
  });

  expect(hydrationRan).toBe(true);
  expect(errors).toHaveLength(1);
});
