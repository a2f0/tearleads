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
  MiniAppKeyValueList,
  MiniAppKeyValueRow,
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
      <MiniAppKeyValueList className="identity-manager-session-detail-table">
        <MiniAppKeyValueRow label="Status">
          {getSessionStatusLabel(session)}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow label="Last Active" title={session.lastActiveAt}>
          <SessionDetailValue
            label="Last Active"
            value={formatMiniAppDateTime(session.lastActiveAt)}
          />
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow
          label="Last IP"
          title={session.lastActiveIp ?? "No recorded IP"}
        >
          <SessionDetailValue label="Last IP" value={session.lastActiveIp} />
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow
          label="Full IP List"
          title={sessionIpAddressesTitle(session.ipAddresses)}
        >
          <SessionDetailValue
            label="Full IP List"
            value={session.ipAddresses.join(", ")}
          />
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow label="Created" title={session.createdAt}>
          <SessionDetailValue
            label="Created"
            value={formatMiniAppDateTime(session.createdAt)}
          />
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow
          label="Signing Key"
          title={session.signingKeyFingerprint}
        >
          <SessionDetailValue
            label="Signing Key"
            value={session.signingKeyFingerprint}
          />
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow label="Session ID" title={session.id}>
          <SessionDetailValue label="Session ID" value={session.id} />
        </MiniAppKeyValueRow>
      </MiniAppKeyValueList>
    </MiniAppSection>
  );
}
