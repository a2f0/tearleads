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
  resumeInterruptedWork: () => Promise<void>;
}

export async function resumeRemoteContainerRecoveryWork(input: {
  onIngestionError: (error: unknown) => void;
  onHydrationError: (error: unknown) => void;
  resumeHydration: () => Promise<void>;
  resumeIngestion: () => Promise<void>;
}): Promise<void> {
  try {
    await input.resumeIngestion();
  } catch (error) {
    input.onIngestionError(error);
    return;
  }
  try {
    await input.resumeHydration();
  } catch (error) {
    input.onHydrationError(error);
  }
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
    resumeInterruptedWork: () =>
      resumeRemoteContainerRecoveryWork({
        onHydrationError: (error) => {
          state.runtime.util.log(
            `${getContainerContentsStoreLogLabel(state)}: failed to resume remote hydration: ${errorMessage(error)}`,
          );
        },
        onIngestionError: (error) => {
          state.runtime.util.log(
            `${getContainerContentsStoreLogLabel(state)}: failed to resume remote container ingestion: ${errorMessage(error)}`,
          );
        },
        resumeHydration: async () => {
          await resumeContainerContentsRecoveryHydration(state);
        },
        resumeIngestion,
      }),
  };
}
