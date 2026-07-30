import { describeRemoteContainerHydration } from "../remoteHydrationLog";
import type {
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
} from "./types";

export async function finishRemoteHydration(input: {
  changedCount: number;
  complete: boolean;
  host: RemoteContainerHydrationHost;
  onFullyHydrated?: (() => Promise<void> | void) | undefined;
  seenContainerIds: ReadonlySet<string>;
  containerIdsBeforeHydration: ReadonlySet<string>;
  state: RemoteContainerHydrationState;
}): Promise<void> {
  if (input.changedCount > 0) {
    input.host.updateSnapshot();
    let insertedCount = 0;
    for (const containerId of input.seenContainerIds) {
      if (!input.containerIdsBeforeHydration.has(containerId)) {
        insertedCount++;
      }
    }
    input.state.runtime.util.log(
      describeRemoteContainerHydration({
        changedCount: input.changedCount,
        insertedCount,
      }),
    );
  }
  if (input.complete && input.onFullyHydrated) {
    await input.onFullyHydrated();
  }
}
