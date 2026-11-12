import type {
  OrganizationDirectoryUser,
  OrganizationGroupMembers,
} from "@tearleads/client-sdk";
import { MiniAppSelectMenu } from "../../../components/mini-app/controls/MiniAppSelectMenu";
import {
  MiniAppButton,
  MiniAppInput,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { compactFingerprint, getRosterUserLabel } from "../display";
import { ORG_MANAGER_LABELS } from "../labels";

export function GroupAddMemberToolbar({
  addableUsers,
  adding,
  addUserId,
  memberUserIds,
  members,
  mutating,
  onAdd,
  profileDisplayNamesByUserId,
  setAddUserId,
}: {
  addableUsers: ReadonlyArray<OrganizationDirectoryUser>;
  adding: boolean;
  addUserId: string;
  memberUserIds: ReadonlySet<string>;
  members: OrganizationGroupMembers | null;
  mutating: boolean;
  onAdd: () => void;
  profileDisplayNamesByUserId: ReadonlyMap<string, string>;
  setAddUserId: (userId: string) => void;
}) {
  const options = addableUsers.map((user) => {
    const label = getRosterUserLabel(user, profileDisplayNamesByUserId);
    const idLabel = compactFingerprint(user.userId);
    return {
      id: user.userId,
      label,
      secondaryLabel: label === idLabel ? undefined : idLabel,
    };
  });
  const hasRosterSelection = options.some((option) => option.id === addUserId);

  return (
    <MiniAppToolbar className="org-manager-form-toolbar" wrap>
      <MiniAppSelectMenu
        ariaLabel={ORG_MANAGER_LABELS.rosterUser}
        className="org-manager-roster-picker"
        disabled={mutating}
        onChange={setAddUserId}
        options={options}
        placeholder={ORG_MANAGER_LABELS.chooseRosterUser}
        value={hasRosterSelection ? addUserId : ""}
      />
      <MiniAppInput
        aria-label={ORG_MANAGER_LABELS.rosterIdentity}
        disabled={mutating}
        onChange={(event) => setAddUserId(event.target.value)}
        placeholder={ORG_MANAGER_LABELS.pasteIdentityLink}
        value={hasRosterSelection ? "" : addUserId}
      />
      <MiniAppButton
        disabled={
          mutating ||
          !members ||
          addUserId.trim().length === 0 ||
          memberUserIds.has(addUserId.trim())
        }
        onClick={onAdd}
        loading={adding}
      >
        {ORG_MANAGER_LABELS.add}
      </MiniAppButton>
    </MiniAppToolbar>
  );
}
