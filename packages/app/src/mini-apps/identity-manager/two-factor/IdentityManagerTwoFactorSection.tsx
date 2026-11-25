import {
  MiniAppButton,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import type { useIdentityManager } from "../IdentityManagerController";
import { IdentityManagerSignInGate } from "../panels/IdentityManagerSignInGate";
import { TwoFactorOnView } from "./TwoFactorOnView";
import { TwoFactorRecoveryCodesView } from "./TwoFactorRecoveryCodesView";
import { TwoFactorSetupView } from "./TwoFactorSetupView";
import { type TwoFactorPanel, useTwoFactorPanel } from "./useTwoFactorPanel";
import "./TwoFactor.css";

const TITLE = "Two-Factor";

function requiredByMessage(count: number): string {
  return count === 1
    ? "An organization you belong to requires two-factor authentication. Set it up to use that organization again."
    : `${count} organizations you belong to require two-factor authentication. Set it up to use them again.`;
}

function TwoFactorPanelBody({ panel }: { readonly panel: TwoFactorPanel }) {
  const { busy, state } = panel;
  switch (state.status) {
    case "loading":
      return <MiniAppStatus role="status">Loading...</MiniAppStatus>;
    case "failed":
      return (
        <>
          <MiniAppStatus role="alert" tone="error">
            {state.message}
          </MiniAppStatus>
          <MiniAppToolbar>
            <MiniAppButton onClick={() => void panel.retry()} type="button">
              Try again
            </MiniAppButton>
          </MiniAppToolbar>
        </>
      );
    case "off":
      return (
        <>
          {state.requiredByOrganizationIds.length > 0 && (
            <MiniAppStatus role="alert" tone="error">
              {requiredByMessage(state.requiredByOrganizationIds.length)}
            </MiniAppStatus>
          )}
          <MiniAppStatus>
            Two-factor authentication asks for a code from an authenticator app
            each time this identity signs in on a new device.
          </MiniAppStatus>
          <MiniAppToolbar>
            <MiniAppButton
              loading={busy === "setup"}
              onClick={() => void panel.beginSetup()}
              type="button"
            >
              {busy === "setup" ? "Starting..." : "Set up"}
            </MiniAppButton>
          </MiniAppToolbar>
        </>
      );
    case "setting-up":
      return (
        <TwoFactorSetupView
          busy={busy === "enable"}
          onCancel={panel.cancelSetup}
          onEnable={(code, rememberDevice) =>
            void panel.enable(code, rememberDevice)
          }
          setup={state.setup}
        />
      );
    case "showing-codes":
      return (
        <TwoFactorRecoveryCodesView
          onDone={() => void panel.acknowledgeCodes()}
          recoveryCodes={state.recoveryCodes}
        />
      );
    case "on":
      return (
        <TwoFactorOnView
          busy={busy}
          current={state.current}
          onDisable={panel.disable}
          onRegenerate={panel.regenerate}
        />
      );
  }
}

function SignedInTwoFactorSection() {
  const panel = useTwoFactorPanel();
  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>{TITLE}</h2>
      </MiniAppSectionHeading>
      {panel.error && (
        <MiniAppStatus role="alert" tone="error">
          {panel.error}
        </MiniAppStatus>
      )}
      <TwoFactorPanelBody panel={panel} />
    </MiniAppSection>
  );
}

export function IdentityManagerTwoFactorSection({
  model,
}: {
  readonly model: ReturnType<typeof useIdentityManager>;
}) {
  if (!model.canManageSessions) {
    return (
      <IdentityManagerSignInGate
        message="Log in to manage two-factor authentication."
        model={model}
        title={TITLE}
      />
    );
  }
  return <SignedInTwoFactorSection />;
}
