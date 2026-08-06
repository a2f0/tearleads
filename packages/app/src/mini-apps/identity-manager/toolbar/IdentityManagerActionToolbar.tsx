import {
  MiniAppButton,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";

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

// The current-session logout lives in the Identity section's overflow menu
// (see IdentityManagerActionsMenu), so it is intentionally not rendered here
// even though the shared props type still carries its handler.
export function IdentityActionToolbar({
  canAuthenticate,
  canGenerateKey,
  canRegisterCurrentIdentity,
  generateKey,
  handleAuthenticate,
  handleDestroyKeyPair,
  handleRegisterIdentity,
  hasSigningKeyPair,
  identityBusy,
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
      {hasSigningKeyPair && (
        <MiniAppButton
          disabled={identityBusy !== null}
          onClick={handleDestroyKeyPair}
        >
          Destroy Key Pair
        </MiniAppButton>
      )}
    </MiniAppToolbar>
  );
}
