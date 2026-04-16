import type { AppHostConfig } from "../../../host/AppHostConfig";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "../../pane/DualPaneProvider";
import { Pane } from "../../pane/Pane";
import { PaneProvider } from "../../pane/PaneProvider";

interface WorkspaceProps {
  hostConfig: AppHostConfig;
  active: boolean;
  split: boolean;
}

export function Workspace({ hostConfig, active, split }: WorkspaceProps) {
  return (
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={hostConfig}>
          <Pane className={`pane pane-left${active ? "" : " pane-hidden"}`} />
        </PaneProvider>
      </PaneSideProvider>
      <PaneSideProvider side="right">
        <PaneProvider hostConfig={hostConfig}>
          <Pane
            className={`pane pane-right${active ? "" : " pane-hidden"}${!split ? " pane-unsplit" : ""}`}
          />
        </PaneProvider>
      </PaneSideProvider>
    </DualPaneProvider>
  );
}
