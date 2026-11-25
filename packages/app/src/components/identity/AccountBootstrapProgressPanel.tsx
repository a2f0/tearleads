import { type FormEvent, useState } from "react";
import type { AccountBootstrapCopy } from "../../identity/accountBootstrapPhase";
import { useAutoProvisioningStatus } from "../../identity/autoProvisioningStatus";
import { useLegalTermsAgreement } from "../../identity/legalTermsAgreement";
import { useRecoveryKeyPrivacy } from "../../identity/useRecoveryKeyPrivacy";
import {
  MiniAppButton,
  MiniAppInput,
  MiniAppStatePanel,
  MiniAppStatus,
  MiniAppTextarea,
  MiniAppToolbar,
} from "../mini-app/MiniAppLayout";
import { useMiniAppDetailBackAction } from "../mini-app/useMiniAppDetailBackAction";
import "./AccountBootstrapProgressPanel.css";
import { TelemetryConsentSwitch } from "../shared/TelemetryConsentSwitch";
import { LegalTermsAgreementPanel } from "./legal-terms/LegalTermsAgreementPanel";
import { RecoveryKeyBackupConfirmation } from "./recovery-key/RecoveryKeyBackupConfirmation";
import { RecoveryKeyScanControl } from "./recovery-key/RecoveryKeyScanControl";
import { SavedPassphraseButton } from "./SavedPassphraseButton";

function IdentityForm({ copy }: { copy: AccountBootstrapCopy }) {
  const { accountNaming, onboarding, submitAccountName } =
    useAutoProvisioningStatus();
  const restoring = copy.phase === "entering-passphrase";
  const error =
    onboarding && "error" in onboarding.state
      ? onboarding.state.error
      : accountNaming.status === "awaiting"
        ? accountNaming.error
        : undefined;
  const [value, setValue] = useState("");
  useRecoveryKeyPrivacy(() => {
    if (restoring) setValue("");
  });
  const leaveForm = onboarding
    ? () => onboarding.navigate("choosing-identity")
    : null;
  // The form is a phase of the onboarding machine, not a route, so the host's
  // history Back (browser history routed, the window's stack windowed) cannot
  // leave it. Register the toolbar Back in every host, above a mini-app's own
  // detail Back, since the form is what the user is looking at.
  useMiniAppDetailBackAction(
    leaveForm ? { label: "Back", onBack: leaveForm, priority: 200 } : null,
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!value.trim()) return;
    if (onboarding) {
      onboarding.submit(
        restoring ? "entering-passphrase" : "naming-account",
        value,
      );
    } else if (!restoring) {
      submitAccountName(value);
    }
  };
  return (
    <MiniAppStatePanel description={copy.description} title={copy.title}>
      <form className="identity-onboarding-form" onSubmit={submit}>
        {restoring ? (
          <MiniAppTextarea
            aria-label="Recovery passphrase"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            rows={3}
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
        ) : (
          <MiniAppInput
            aria-label={copy.title}
            autoComplete="nickname"
            onChange={(event) => setValue(event.currentTarget.value)}
            placeholder="Bob"
            value={value}
          />
        )}
        {restoring && onboarding && (
          // A scan is already a validated key, so it restores without a
          // second step and the key never sits in the field.
          <RecoveryKeyScanControl
            disabled={false}
            label="Restore from QR code"
            onScan={(phrase) =>
              onboarding.submit("entering-passphrase", phrase)
            }
          />
        )}
        {restoring && (
          <SavedPassphraseButton disabled={false} onPick={setValue} />
        )}
        <MiniAppToolbar>
          {leaveForm && (
            <MiniAppButton type="button" variant="ghost" onClick={leaveForm}>
              Back
            </MiniAppButton>
          )}
          <MiniAppButton disabled={!value.trim()} type="submit">
            {restoring ? "Restore from passphrase" : "Continue"}
          </MiniAppButton>
        </MiniAppToolbar>
      </form>
      {error && (
        <MiniAppStatus role="alert" tone="error">
          {error}
        </MiniAppStatus>
      )}
    </MiniAppStatePanel>
  );
}

export function AccountBootstrapProgressPanel({
  progress,
}: {
  progress: AccountBootstrapCopy;
}) {
  const { onboarding } = useAutoProvisioningStatus();
  const { agree } = useLegalTermsAgreement();
  if (progress.phase === "accepting-terms") {
    // Onboarding goes on to naming the new identity; a held registration
    // resumes on its own once the agreement is recorded.
    return onboarding ? (
      <LegalTermsAgreementPanel
        onAgree={onboarding.agreeToTerms}
        onBack={() => onboarding.navigate("choosing-identity")}
      />
    ) : (
      <LegalTermsAgreementPanel onAgree={agree} />
    );
  }
  if (progress.phase === "choosing-identity" && onboarding) {
    return (
      <MiniAppStatePanel
        description={progress.description}
        title={progress.title}
      >
        <MiniAppToolbar>
          <MiniAppButton onClick={() => onboarding.navigate("naming-account")}>
            Create new identity
          </MiniAppButton>
          <MiniAppButton
            onClick={() => onboarding.navigate("entering-passphrase")}
          >
            Restore identity
          </MiniAppButton>
        </MiniAppToolbar>
        {/* Asked once at the start, so creating and restoring both offer it. */}
        <TelemetryConsentSwitch />
      </MiniAppStatePanel>
    );
  }
  if (progress.phase === "confirming-backup" && onboarding) {
    return (
      <RecoveryKeyBackupConfirmation onConfirm={onboarding.confirmBackup} />
    );
  }
  if (
    progress.phase === "naming-account" ||
    progress.phase === "entering-passphrase"
  ) {
    return <IdentityForm key={progress.phase} copy={progress} />;
  }
  return (
    <MiniAppStatePanel
      busy
      description={progress.description}
      title={progress.title}
    />
  );
}
