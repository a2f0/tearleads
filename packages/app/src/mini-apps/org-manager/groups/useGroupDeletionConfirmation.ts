import type { OrganizationGroupSummary } from "@tearleads/client-sdk";
import { useState } from "react";

export function useGroupDeletionConfirmation({
  canDeleteGroup,
  deleteGroup,
  groups,
  mutating,
}: {
  canDeleteGroup: (group: OrganizationGroupSummary) => boolean;
  deleteGroup: (groupId: string) => void;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  mutating: boolean;
}) {
  const [groupId, setGroupId] = useState<string | null>(null);
  const group =
    groups.find((candidate) => candidate.groupId === groupId) ?? null;
  const disabled = mutating || !group || !canDeleteGroup(group);

  const confirm = () => {
    if (disabled || !group) {
      return;
    }
    setGroupId(null);
    deleteGroup(group.groupId);
  };

  return {
    cancel: () => setGroupId(null),
    confirm,
    disabled,
    group,
    request: setGroupId,
  };
}
