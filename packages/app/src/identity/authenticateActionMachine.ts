import type { TwoFactorLoginErrorCode } from "@tearleads/client-sdk";

/**
 * A sign-in attempt from the current identity. `prompt` stays set while the
 * person is being asked for a second factor, through the attempt that sends
 * one, so the code form stays on screen until a sign-in succeeds or the
 * error is dismissed.
 */
export type AuthenticateActionState =
  | { readonly status: "idle" }
  | {
      readonly status: "authenticating";
      readonly prompt: TwoFactorLoginErrorCode | null;
    }
  | {
      readonly status: "failed";
      readonly message: string;
      readonly prompt: TwoFactorLoginErrorCode | null;
    };

export type AuthenticateActionEvent =
  | { readonly type: "started" }
  | { readonly type: "succeeded" }
  | { readonly type: "failed"; readonly message: string }
  | {
      readonly type: "second-factor-refused";
      readonly message: string;
      readonly prompt: TwoFactorLoginErrorCode;
    }
  | { readonly type: "dismissed" };

export const INITIAL_AUTHENTICATE_ACTION_STATE: AuthenticateActionState = {
  status: "idle",
};

function currentPrompt(
  state: AuthenticateActionState,
): TwoFactorLoginErrorCode | null {
  return state.status === "idle" ? null : state.prompt;
}

export function transitionAuthenticateAction(
  state: AuthenticateActionState,
  event: AuthenticateActionEvent,
): AuthenticateActionState {
  switch (event.type) {
    case "started":
      return { prompt: currentPrompt(state), status: "authenticating" };
    case "succeeded":
      return INITIAL_AUTHENTICATE_ACTION_STATE;
    case "failed":
      // An ordinary failure keeps the code form if one was showing.
      return {
        message: event.message,
        prompt: currentPrompt(state),
        status: "failed",
      };
    case "second-factor-refused":
      return { message: event.message, prompt: event.prompt, status: "failed" };
    case "dismissed":
      return state.status === "authenticating"
        ? { prompt: null, status: "authenticating" }
        : INITIAL_AUTHENTICATE_ACTION_STATE;
  }
}
