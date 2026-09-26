import type { ContainerContentsStore } from "@tearleads/client-sdk";
import { useEffect } from "react";
import {
  type PaneSide,
  usePaneSide,
} from "../../../src/components/pane/dual-pane";
import { useDeviceFirstContainerContents } from "../../../src/stores/device-first/DeviceFirstProvider";

export function ContainerTreeProbe({
  trees,
}: {
  trees: Map<PaneSide, ContainerContentsStore>;
}) {
  const side = usePaneSide();
  const { containerStore } = useDeviceFirstContainerContents();
  useEffect(() => {
    trees.set(side, containerStore);
    return () => {
      trees.delete(side);
    };
  }, [containerStore, side, trees]);
  return null;
}
