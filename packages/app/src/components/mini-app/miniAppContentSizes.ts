import type { WindowSize } from "@tearleads/windowing";
import type { MiniAppId } from "../../mini-apps/types";

// Content-area targets, not outer window sizes: windowing adds the current
// sidebar, bars, padding, and scrollbars and clamps the result to the desktop.
// Forms leave room for the 34rem minimum used by identity and backup settings.
const FORM = { height: 480, width: 560 } as const;
const DOCUMENT = { height: 560, width: 720 } as const;
const DIAGNOSTICS = { height: 560, width: 800 } as const;

// Lists, editors, and logs have no finite natural height. Give them useful
// working viewports instead of expanding to every record or line. Display
// Properties reports its measured, finite content size from its own component.
export const MINI_APP_CONTENT_SIZES = {
  "backup-restore": FORM,
  contacts: FORM,
  "display-properties": undefined,
  explorer: DOCUMENT,
  "identity-manager": FORM,
  notes: DOCUMENT,
  "org-manager": DOCUMENT,
  organizations: FORM,
  root: DIAGNOSTICS,
  "system-monitor": DIAGNOSTICS,
} as const satisfies Record<MiniAppId, WindowSize | undefined>;
