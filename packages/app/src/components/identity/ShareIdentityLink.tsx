import { useState } from "react";
import { useIdentityLinks } from "../../providers/identity-links/useIdentityLinks";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import {
  MiniAppButton,
  MiniAppClipboardButton,
  MiniAppField,
  MiniAppInput,
  MiniAppStatus,
  MiniAppToolbar,
} from "../mini-app/MiniAppLayout";

/** Key the disclosure to the current local identity so a switch clears it. */
export function ShareIdentityLink() {
  const runtime = useTearleadsRuntime();
  return (
    <IdentityLinkDisclosure
      key={`${runtime.auth.userId}:${runtime.crypto.signingFingerprint}`}
      available={runtime.auth.isAuthenticated}
    />
  );
}

function IdentityLinkDisclosure({ available }: { available: boolean }) {
  const { createLink } = useIdentityLinks();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const showLink = async () => {
    setBusy(true);
    setError(null);
    try {
      setLink(await createLink());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to create your identity link.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <MiniAppToolbar>
        <MiniAppButton
          disabled={!available || busy}
          onClick={() => void showLink()}
        >
          {busy ? "Preparing identity link..." : "Share my identity link"}
        </MiniAppButton>
      </MiniAppToolbar>
      {!available && (
        <MiniAppStatus>Sign in to share your identity link.</MiniAppStatus>
      )}
      {error && (
        <MiniAppStatus tone="error" role="alert">
          {error}
        </MiniAppStatus>
      )}
      {link && (
        <>
          <MiniAppField>
            <span>My identity link</span>
            <MiniAppInput
              aria-label="My identity link"
              readOnly
              value={link}
              onFocus={(event) => event.target.select()}
            />
          </MiniAppField>
          <MiniAppClipboardButton value={link} label="Copy identity link" />
          <MiniAppStatus>
            Send this link through a trusted channel so others can verify you
            before adding you.
          </MiniAppStatus>
        </>
      )}
    </div>
  );
}
