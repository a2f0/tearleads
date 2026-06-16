import type {
  ContainerNode,
  LocalProjectionView,
  ReconciliationService,
} from "@tearleads/client-sdk";
import { enqueueReconciliationForEvents } from "@tearleads/client-sdk";
import { useEffect, useMemo } from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";

/**
 * Wire the explorer to the device-first SDK seam: the local projection view
 * (instant reads) and the background reconciler. Server events are routed into
 * the reconciler here so the provider never drives network from a render effect.
 */
export function useExplorerDeviceFirst(input: {
  domainScope: object;
  events: ReadonlyArray<unknown>;
  nodes: ReadonlyArray<ContainerNode>;
}): { reconciler: ReconciliationService; view: LocalProjectionView } {
  const tearleads = useTearleads();
  const { domainScope } = input;
  const view = useMemo(
    () => tearleads.deviceFirst.openView({ logLabel: "Explorer" }),
    [domainScope, tearleads],
  );
  const reconciler = useMemo(
    () => tearleads.deviceFirst.reconciler(),
    [domainScope, tearleads],
  );

  const { events, nodes } = input;
  useEffect(() => {
    if (events.length === 0) {
      return;
    }
    enqueueReconciliationForEvents({
      events,
      knownContainerIds: nodes.flatMap((node) =>
        node.systemSlot ? [] : [node.id],
      ),
      service: reconciler,
    });
  }, [events, nodes, reconciler]);

  return { reconciler, view };
}
