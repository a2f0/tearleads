import type {
  MiniAppDefinition as LauncherMiniAppDefinition,
  OpenMiniAppRequest as LauncherOpenMiniAppRequest,
} from "@tearleads/windowing";
import type { ContactsMiniAppMessage } from "./contacts/messages";
import type { OrgManagerMiniAppMessage } from "./org-manager/messages";

const MINI_APP_IDS = [
  "backup-restore",
  "contacts",
  "explorer",
  "identity-manager",
  "notes",
  "org-manager",
  "root",
  "system-monitor",
] as const;

export type MiniAppId = (typeof MINI_APP_IDS)[number];

// Window state stores an app id as an opaque string; narrow it back here.
export function isMiniAppId(
  value: string | null | undefined,
): value is MiniAppId {
  return MINI_APP_IDS.some((appId) => appId === value);
}

// The windowing launcher's definition of one app (title, icon, component, and
// sidebar default); registry.ts gives one for every mini-app.
export type MiniAppDefinition = LauncherMiniAppDefinition;

export interface MiniAppWindowPosition {
  x: number;
  y: number;
}

// Each mini-app owns the messages it accepts; the bus carries their union.
export type MiniAppMessage = ContactsMiniAppMessage | OrgManagerMiniAppMessage;

// The launcher's open request, plus a message the bus delivers to the app.
export interface OpenMiniAppRequest
  extends LauncherOpenMiniAppRequest<MiniAppId> {
  message?: MiniAppMessage;
}
