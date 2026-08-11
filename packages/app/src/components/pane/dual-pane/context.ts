import {
  createRequiredContext,
  type RequiredContext,
} from "../../../utils/createRequiredContext";
import type { DualPaneContextValue, PaneSide } from "./types";

export const dualPaneContext: RequiredContext<DualPaneContextValue> =
  createRequiredContext("useDualPane must be used within a DualPaneProvider.");

export const paneSideContext: RequiredContext<PaneSide> = createRequiredContext(
  "usePaneSide must be used within a PaneSideProvider.",
);
