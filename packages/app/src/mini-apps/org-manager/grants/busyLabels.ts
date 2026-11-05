/**
 * Titles and descriptions for Org Manager's full-modal busy overlays, shown
 * while an action that cannot be cancelled is in flight.
 */
export const ORG_MANAGER_BUSY_LABELS = {
  creatingGroup: "Creating group...",
  creatingGroupDescription:
    "Generating the group's keys and signing its policy.",
  creatingOrganizationDescription:
    "Generating the organization's keys and setting up its root folder.",
  revokingGrant: "Revoking access...",
  revokingGrantDescription:
    "Removing the grant and updating who can read this folder.",
} as const;
