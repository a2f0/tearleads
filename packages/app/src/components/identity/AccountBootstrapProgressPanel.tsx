import { type FormEvent, useState } from "react";
import type { AccountBootstrapCopy } from "../../identity/accountBootstrapPhase";
import { normalizeAccountName } from "../../identity/accountNamingMachine";
import { useAutoProvisioningStatus } from "../../identity/autoProvisioningStatus";
import {
  MiniAppButton,
  MiniAppInput,
  MiniAppStatePanel,
  MiniAppStatus,
} from "../mini-app/MiniAppLayout";
import "./AccountBootstrapProgressPanel.css";

function AccountNamePrompt({ copy }: { copy: AccountBootstrapCopy }) {
  const { accountNaming, submitAccountName } = useAutoProvisioningStatus();
  const error =
    accountNaming.status === "awaiting" ? accountNaming.error : undefined;
  const [name, setName] = useState("");
  const canSubmit = normalizeAccountName(name) !== null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSubmit) {
      submitAccountName(name);
    }
  };

  return (
    <MiniAppStatePanel description={copy.description} title={copy.title}>
      <form className="account-name-prompt" onSubmit={submit}>
        <MiniAppInput
          aria-label={copy.title}
          autoComplete="nickname"
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="Bob"
          value={name}
        />
        <MiniAppButton disabled={!canSubmit} type="submit">
          Continue
        </MiniAppButton>
      </form>
      {error ? (
        <MiniAppStatus role="alert" tone="error">
          {error}
        </MiniAppStatus>
      ) : null}
    </MiniAppStatePanel>
  );
}

/**
 * The whole-surface state of an account that is still bootstrapping: the
 * "What should we call you?" prompt while registration waits for a name, and
 * the phase's progress with a spinner otherwise.
 */
export function AccountBootstrapProgressPanel({
  progress,
}: {
  progress: AccountBootstrapCopy;
}) {
  if (progress.phase === "naming-account") {
    return <AccountNamePrompt copy={progress} />;
  }
  return (
    <MiniAppStatePanel
      busy
      description={progress.description}
      title={progress.title}
    />
  );
}
