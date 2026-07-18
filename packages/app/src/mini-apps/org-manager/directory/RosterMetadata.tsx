import type { OrganizationUserDetail } from "@tearleads/client-sdk";
import type { ReactNode } from "react";
import { MiniAppClipboardButton } from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import { compactFingerprint } from "../display";
import { ORG_MANAGER_LABELS } from "../labels";

function formatNullableDate(value: string | null): string {
  return value ? formatMiniAppDate(value) : ORG_MANAGER_LABELS.none;
}

function getNullableIdentifierLabel(value: string | null): string {
  return value ? compactFingerprint(value) : ORG_MANAGER_LABELS.none;
}

function RosterMetadataRow({
  action,
  label,
  title,
  value,
}: {
  action?: ReactNode | undefined;
  label: string;
  title?: string | undefined;
  value: string;
}) {
  return (
    <MiniAppRow className="org-manager-roster-row" density="roomy">
      <MiniAppRowStack>
        <strong>{label}</strong>
        <MiniAppRowText muted title={title}>
          {value}
        </MiniAppRowText>
      </MiniAppRowStack>
      {action}
    </MiniAppRow>
  );
}

export function UserRosterMetadata({
  user,
}: {
  user: OrganizationUserDetail["user"];
}) {
  return (
    <div className="org-manager-roster-metadata">
      <RosterMetadataRow
        action={
          <MiniAppClipboardButton
            label={ORG_MANAGER_LABELS.copyUserIdAction}
            value={user.userId}
          />
        }
        label={ORG_MANAGER_LABELS.userId}
        title={user.userId}
        value={compactFingerprint(user.userId)}
      />
      <RosterMetadataRow
        label={ORG_MANAGER_LABELS.signingKey}
        title={user.signingKeyFingerprint}
        value={compactFingerprint(user.signingKeyFingerprint)}
      />
      <RosterMetadataRow
        label={ORG_MANAGER_LABELS.joined}
        title={user.joinedAt}
        value={formatMiniAppDate(user.joinedAt)}
      />
      <RosterMetadataRow
        label={ORG_MANAGER_LABELS.disabledAt}
        title={user.disabledAt ?? undefined}
        value={formatNullableDate(user.disabledAt)}
      />
      <RosterMetadataRow
        label={ORG_MANAGER_LABELS.disabledBy}
        title={user.disabledByUserId ?? undefined}
        value={getNullableIdentifierLabel(user.disabledByUserId)}
      />
    </div>
  );
}
