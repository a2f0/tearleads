import type { ComponentType } from "react";

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

export type MiniAppMessage =
  | {
      appId: "contacts";
      type: "import-contact";
      userId: string;
    }
  | {
      appId: "org-manager";
      groupId: string;
      type: "open-group";
    }
  | {
      appId: "org-manager";
      containerId: string;
      subjectId: string;
      subjectType: "group" | "user";
      type: "open-grant";
    };

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
