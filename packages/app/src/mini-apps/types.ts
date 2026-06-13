import type { ComponentType } from "react";

export type MiniAppId =
  | "contacts"
  | "explorer"
  | "identity-manager"
  | "notes"
  | "org-manager";

export interface MiniAppDefinition {
  createComponent: () => ComponentType;
  initialShowSidebar?: boolean | undefined;
  title: string;
}

export interface MiniAppWindowPosition {
  x: number;
  y: number;
}

export type MiniAppMessage = {
  appId: "org-manager";
  groupId: string;
  type: "open-group";
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
