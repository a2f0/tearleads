import { useEffect, useState } from "react";
import {
  type ContainerViewResource,
  type ContainerViewResourceEvent,
  transitionContainerViewResource,
} from "./containerViewResourceMachine";

/** Only an explicit, unchanged resource identity may retain data during refresh. */
export function useContainerViewResource<T>(
  load: () => Promise<T>,
  identity?: object,
): ContainerViewResource<T> {
  const [state, setState] = useState<ContainerViewResource<T>>({
    status: "loading",
    request: load,
  });
  useEffect(() => {
    let active = true;
    const send = (event: ContainerViewResourceEvent<T>) => {
      if (active)
        setState((current) => transitionContainerViewResource(current, event));
    };
    send({ type: "start", request: load, identity });
    void load().then(
      (value) => send({ type: "loaded", request: load, value }),
      (error: unknown) =>
        send({
          type: "failed",
          request: load,
          error:
            error instanceof Error
              ? error.message
              : "Unable to load container view",
        }),
    );
    return () => {
      active = false;
    };
  }, [load, identity]);
  return state.request === load && state.identity === identity
    ? state
    : transitionContainerViewResource(state, {
        type: "start",
        request: load,
        identity,
      });
}
