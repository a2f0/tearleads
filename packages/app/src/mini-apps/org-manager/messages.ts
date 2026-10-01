// Messages other mini-apps send to Org Manager over the mini-app bus.
export interface OrgManagerOpenGroupMessage {
  appId: "org-manager";
  groupId: string;
  type: "open-group";
}

export interface OrgManagerOpenGrantMessage {
  appId: "org-manager";
  containerId: string;
  subjectId: string;
  subjectType: "group" | "user";
  type: "open-grant";
}

export type OrgManagerMiniAppMessage =
  | OrgManagerOpenGrantMessage
  | OrgManagerOpenGroupMessage;
