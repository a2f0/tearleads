import {
  MiniAppButton,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { IdentityManagerActionsMenu } from "../menu/IdentityManagerActionsMenu";

export type IdentityBusyState =
  | "authenticate"
  | "register"
  | "transition"
  | null;

export interface IdentityActionToolbarProps {
  readonly canAuthenticate: boolean;
  readonly canGenerateKey: boolean;
  readonly canRegisterCurrentIdentity: boolean;
  readonly generateKey: () => void;
  readonly handleAuthenticate: () => Promise<void>;
  readonly handleDestroyKeyPair: () => void;
  readonly handleLogoutCurrentSession: () => void;
  readonly handleRegisterIdentity: () => Promise<void>;
  readonly hasSigningKeyPair: boolean;
  readonly identityBusy: IdentityBusyState;
  readonly isAuthenticated: boolean;
  readonly mutatingSessionId: string | null;
}

export function IdentityActionToolbar({
  canAuthenticate,
  canGenerateKey,
  canRegisterCurrentIdentity,
  generateKey,
  handleAuthenticate,
  handleLogoutCurrentSession,
  handleRegisterIdentity,
  hasSigningKeyPair,
  identityBusy,
  isAuthenticated,
  mutatingSessionId,
}: IdentityActionToolbarProps) {
  return (
    <MiniAppToolbar wrap>
      {canGenerateKey && !hasSigningKeyPair && (
        <MiniAppButton disabled={identityBusy !== null} onClick={generateKey}>
          Generate Key Pair
        </MiniAppButton>
      )}
      {canRegisterCurrentIdentity && (
        <MiniAppButton
          disabled={identityBusy !== null}
          onClick={() => void handleRegisterIdentity()}
        >
          Register
        </MiniAppButton>
      )}
      {canAuthenticate && (
        <MiniAppButton
          disabled={identityBusy !== null}
          onClick={() => void handleAuthenticate()}
        >
          Login
        </MiniAppButton>
      )}
      <IdentityManagerActionsMenu
        disabled={identityBusy !== null || mutatingSessionId !== null}
        isAuthenticated={isAuthenticated}
        onLogout={handleLogoutCurrentSession}
      />
    </MiniAppToolbar>
  );
}

/**
 * Destroying the key pair stands apart from the routine actions above it, in
 * the danger color, with a line saying what it does.
 */
export function IdentityDestroyKeyPair({
  disabled,
  onDestroy,
}: {
  disabled: boolean;
  onDestroy: () => void;
}) {
  return (
    <div className="identity-manager-danger-zone">
      <div className="identity-manager-danger-zone-copy">
        <strong>Destroy this identity on this device</strong>
        <MiniAppStatus as="span">
          Removes its keys from this device. Only your recovery phrase can
          restore it.
        </MiniAppStatus>
      </div>
      <MiniAppButton disabled={disabled} onClick={onDestroy} variant="danger">
        Destroy Key Pair
      </MiniAppButton>
    </div>
  );
}
