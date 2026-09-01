import type { UserSession } from "@tearleads/client-sdk";
import { useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppSection,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppInfoRow,
  MiniAppKeyValueTable,
} from "../../../components/mini-app/MiniAppTable";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import {
  compactIdentifier,
  getSessionStatusLabel,
  sessionIpAddressesTitle,
  sessionIsMutating,
} from "./IdentityManagerSessionDisplay";

function SessionDetailValue({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!value) {
    return <span>None</span>;
  }

  return (
    <button
      aria-label={`${value}; ${expanded ? "Collapse" : "Show full"} ${label}`}
      aria-pressed={expanded}
      className={`identity-manager-session-detail-value${expanded ? " identity-manager-session-detail-value--expanded" : ""}`}
      onClick={() => setExpanded((current) => !current)}
      type="button"
    >
      {value}
    </button>
  );
}

export function SessionDetailSection({
  handleEndSession,
  mutatingSessionId,
  onBack,
  session,
}: {
  handleEndSession: (session: UserSession) => Promise<void>;
  mutatingSessionId: string | null;
  onBack: () => void;
  session: UserSession;
}) {
  const rowIsMutating = sessionIsMutating(mutatingSessionId, session);

  return (
    <MiniAppSection className="identity-manager-session-detail">
      <MiniAppHeader className="identity-manager-session-detail-header">
        <MiniAppHeaderCopy>
          <strong>{getSessionStatusLabel(session)} Session</strong>
          <span title={session.id}>{compactIdentifier(session.id)}</span>
        </MiniAppHeaderCopy>
        <MiniAppActions>
          <MiniAppButton
            disabled={mutatingSessionId !== null}
            onClick={() => void handleEndSession(session)}
          >
            {rowIsMutating ? "Working..." : "Log Out Session"}
          </MiniAppButton>
          <MiniAppButton onClick={onBack} variant="ghost">
            Back
          </MiniAppButton>
        </MiniAppActions>
      </MiniAppHeader>
      <MiniAppKeyValueTable className="identity-manager-session-detail-table">
        <tbody>
          <MiniAppInfoRow label="Status">
            {getSessionStatusLabel(session)}
          </MiniAppInfoRow>
          <MiniAppInfoRow label="Last Active" title={session.lastActiveAt}>
            <SessionDetailValue
              label="Last Active"
              value={formatMiniAppDateTime(session.lastActiveAt)}
            />
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label="Last IP"
            title={session.lastActiveIp ?? "No recorded IP"}
          >
            <SessionDetailValue label="Last IP" value={session.lastActiveIp} />
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label="Full IP List"
            title={sessionIpAddressesTitle(session.ipAddresses)}
          >
            <SessionDetailValue
              label="Full IP List"
              value={session.ipAddresses.join(", ")}
            />
          </MiniAppInfoRow>
          <MiniAppInfoRow label="Created" title={session.createdAt}>
            <SessionDetailValue
              label="Created"
              value={formatMiniAppDateTime(session.createdAt)}
            />
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label="Signing Key"
            title={session.signingKeyFingerprint}
          >
            <SessionDetailValue
              label="Signing Key"
              value={session.signingKeyFingerprint}
            />
          </MiniAppInfoRow>
          <MiniAppInfoRow label="Session ID" title={session.id}>
            <SessionDetailValue label="Session ID" value={session.id} />
          </MiniAppInfoRow>
        </tbody>
      </MiniAppKeyValueTable>
    </MiniAppSection>
  );
}
