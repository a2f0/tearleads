import {
  type AccountPurgeInput,
  runAccountPurgeWorkflow,
} from "../../workflows/accounts/purge";
import type { ApiServiceRuntime } from "../runtime";

const OBJECT_CLEANUP_CONCURRENCY = 16;

interface AccountPurgeMaintenanceSummary {
  readonly purgedAccountCount: number;
  readonly deletedObjectCount: number;
  readonly abortedMultipartUploadCount: number;
  readonly failedObjectCleanupCount: number;
}

export async function runAccountPurgeMaintenance(
  runtime: ApiServiceRuntime,
  input: AccountPurgeInput = {},
): Promise<AccountPurgeMaintenanceSummary> {
  const result = await runAccountPurgeWorkflow(runtime.db, input);
  let deletedObjectCount = 0;
  let abortedMultipartUploadCount = 0;
  let failedObjectCleanupCount = 0;
  const objectKeys = result.purgedAccounts.flatMap(
    (account) => account.deletedBlobObjectKeys,
  );
  const multipartStages = result.purgedAccounts.flatMap(
    (account) => account.multipartStageObjects,
  );

  for (
    let start = 0;
    start < objectKeys.length;
    start += OBJECT_CLEANUP_CONCURRENCY
  ) {
    const batch = objectKeys.slice(start, start + OBJECT_CLEANUP_CONCURRENCY);
    await Promise.all(
      batch.map(async (key) => {
        try {
          await runtime.blobObjectStore.deleteObject(key);
          deletedObjectCount += 1;
        } catch {
          failedObjectCleanupCount += 1;
        }
      }),
    );
  }

  for (
    let start = 0;
    start < multipartStages.length;
    start += OBJECT_CLEANUP_CONCURRENCY
  ) {
    const batch = multipartStages.slice(
      start,
      start + OBJECT_CLEANUP_CONCURRENCY,
    );
    await Promise.all(
      batch.map(async (stage) => {
        try {
          if (stage.state === "pending") {
            await runtime.blobObjectStore.abortMultipartUpload({
              key: stage.storageKey,
              uploadId: stage.uploadId,
            });
            abortedMultipartUploadCount += 1;
          } else {
            await runtime.blobObjectStore.deleteObject(stage.storageKey);
            deletedObjectCount += 1;
          }
        } catch {
          failedObjectCleanupCount += 1;
        }
      }),
    );
  }

  return {
    purgedAccountCount: result.purgedAccounts.length,
    deletedObjectCount,
    abortedMultipartUploadCount,
    failedObjectCleanupCount,
  };
}
