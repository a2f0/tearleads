import { errorMessage } from "../../data/errorMessage";
import {
  createRemoteContainerIngestor,
  type RemoteContainer,
  type RemoteContainerHydrationHost,
} from "../../workflows/container-contents/remoteHydration";
import { getContainerContentsStoreLogLabel } from "./logLabel";
import { resumeContainerContentsRecoveryHydration } from "./remoteHydrationRequest";
import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";

interface RemoteContainerIngestionController {
  ingest: (remoteContainer: RemoteContainer) => Promise<void>;
  resumeInterruptedWork: () => void;
}

export function createRemoteContainerIngestionController(input: {
  host: RemoteContainerHydrationHost;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}): RemoteContainerIngestionController {
  const { host, scheduleSync, state } = input;
  const remoteContainerIngestor = createRemoteContainerIngestor({
    getSerializationBarrier: () => state.initializePromise,
    host,
    state,
  });
  const scheduleAfterIngestion = () => {
    if (
      state.runtime.infra.dbStatus === "ready" &&
      state.documentStoresNeedPriming
    ) {
      scheduleSync();
    }
  };
  const resumeIngestion = async () => {
    const hadPendingIngestion = remoteContainerIngestor.hasPending();
    await remoteContainerIngestor.resume();
    if (hadPendingIngestion) {
      scheduleAfterIngestion();
    }
  };

  return {
    ingest: async (remoteContainer) => {
      await remoteContainerIngestor(remoteContainer);
      scheduleAfterIngestion();
    },
    resumeInterruptedWork: () => {
      void resumeIngestion().catch((error: unknown) => {
        state.runtime.util.log(
          `${getContainerContentsStoreLogLabel(state)}: failed to resume remote container ingestion: ${errorMessage(error)}`,
        );
      });
      void resumeContainerContentsRecoveryHydration(state)?.catch(
        (error: unknown) => {
          state.runtime.util.log(
            `${getContainerContentsStoreLogLabel(state)}: failed to resume remote hydration: ${errorMessage(error)}`,
          );
        },
      );
    },
  };
}
