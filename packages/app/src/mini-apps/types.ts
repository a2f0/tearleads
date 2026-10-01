import type { ComponentType } from "react";
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
export function isMiniAppId(value: string | undefined): value is MiniAppId {
  return MINI_APP_IDS.some((appId) => appId === value);
}

export interface MiniAppDefinition {
  createComponent: () => ComponentType;
  initialShowSidebar?: boolean | undefined;
  title: string;
}

export interface MiniAppWindowPosition {
  x: number;
  y: number;
}

// Each mini-app owns the messages it accepts; the bus carries their union.
export type MiniAppMessage = ContactsMiniAppMessage | OrgManagerMiniAppMessage;

export interface OpenMiniAppRequest {
  appId: MiniAppId;
  message?: MiniAppMessage;
  pathSegments?: ReadonlyArray<string> | undefined;
  position?: MiniAppWindowPosition;
  reuseExisting?: boolean | undefined;
}

export const DEFAULT_MINI_APP_POSITION = {
  x: 200,
  y: 160,
} satisfies MiniAppWindowPosition;
