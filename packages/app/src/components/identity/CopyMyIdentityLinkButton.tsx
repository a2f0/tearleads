import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { ClipboardIcon } from "@phosphor-icons/react/dist/csr/Clipboard";
import { useUserIdentityLink } from "../../providers/identity-links/useUserIdentityLink";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useClipboardCopy } from "../mini-app/controls/MiniAppButton";
import {
  MiniAppButton,
  MiniAppStatus,
  MiniAppToolbar,
} from "../mini-app/MiniAppLayout";

/**
 * One click copies the signed-in user's own identity link; the shared
 * clipboard hook reports the copy in the window status bar. The link is
 * resolved up front, so the clipboard write stays inside the click gesture,
 * and it is never rendered.
 */
export function CopyMyIdentityLinkButton() {
  const runtime = useTearleadsRuntime();
  const userId = runtime.auth.isAuthenticated ? runtime.auth.userId : null;
  const { error, link } = useUserIdentityLink(userId);
  const { copied, copy } = useClipboardCopy();

  return (
    <div>
      <MiniAppToolbar>
        <MiniAppButton
          disabled={!link}
          onClick={() => {
            if (link) copy(link);
          }}
          title="Send it through a trusted channel so others can verify you before adding you."
          withIcon
        >
          {copied ? (
            <CheckIcon aria-hidden size={16} />
          ) : (
            <ClipboardIcon aria-hidden size={16} />
          )}
          Copy my identity link
        </MiniAppButton>
      </MiniAppToolbar>
      {!userId && (
        <MiniAppStatus>Sign in to share your identity link.</MiniAppStatus>
      )}
      {error && (
        <MiniAppStatus tone="error" role="alert">
          {error}
        </MiniAppStatus>
      )}
    </div>
  );
}
