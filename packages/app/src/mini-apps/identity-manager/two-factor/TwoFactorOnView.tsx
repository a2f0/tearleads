import type { TwoFactorAnswer, TwoFactorStatus } from "@tearleads/client-sdk";
import { useState } from "react";
import { TwoFactorAnswerForm } from "../../../components/identity/TwoFactorAnswerForm";
import {
  MiniAppButton,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import type { TwoFactorAction } from "./useTwoFactorPanel";

type Change = "disable" | "regenerate" | null;

export function TwoFactorOnView({
  busy,
  current,
  onDisable,
  onRegenerate,
}: {
  readonly busy: TwoFactorAction | null;
  readonly current: TwoFactorStatus;
  readonly onDisable: (answer: TwoFactorAnswer) => Promise<boolean>;
  readonly onRegenerate: (answer: TwoFactorAnswer) => Promise<boolean>;
}) {
  const [change, setChange] = useState<Change>(null);

  return (
    <div className="two-factor-on">
      <dl className="identity-manager-details">
        <dt>Status</dt>
        <dd>On</dd>
        <dt>Recovery codes left</dt>
        <dd>{current.recoveryCodesRemaining}</dd>
      </dl>
      {current.recoveryCodesRemaining <= 2 && (
        <MiniAppStatus tone="error">
          Few recovery codes are left. Get new ones before you run out.
        </MiniAppStatus>
      )}
      {change === null && (
        <MiniAppToolbar>
          <MiniAppButton onClick={() => setChange("regenerate")} type="button">
            New recovery codes
          </MiniAppButton>
          <MiniAppButton
            onClick={() => setChange("disable")}
            type="button"
            variant="danger"
          >
            Turn off
          </MiniAppButton>
        </MiniAppToolbar>
      )}
      {change === "regenerate" && (
        <TwoFactorAnswerForm
          busy={busy === "regenerate"}
          busyLabel="Replacing..."
          label="Replace recovery codes"
          onSubmit={onRegenerate}
        />
      )}
      {change === "disable" && (
        <>
          <MiniAppStatus>
            Turning two-factor off signs out every session, this one too.
            Organizations that require it will refuse this account.
          </MiniAppStatus>
          <TwoFactorAnswerForm
            busy={busy === "disable"}
            busyLabel="Turning off..."
            danger
            label="Turn off two-factor"
            onSubmit={onDisable}
          />
        </>
      )}
      {change !== null && (
        <MiniAppButton
          onClick={() => setChange(null)}
          type="button"
          variant="ghost"
        >
          Cancel
        </MiniAppButton>
      )}
    </div>
  );
}
