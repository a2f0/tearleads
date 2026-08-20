import type { ComponentType } from "react";

export type MiniAppId =
  | "backup-restore"
  | "contacts"
  | "explorer"
  | "identity-manager"
  | "notes"
  | "org-manager"
  | "system-monitor";

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
