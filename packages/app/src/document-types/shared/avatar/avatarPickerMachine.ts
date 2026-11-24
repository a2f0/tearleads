import type { DocumentAttachment } from "@tearleads/client-sdk";

export interface AvatarSource {
  blob: Blob;
  photo?: DocumentAttachment | undefined;
}

export type AvatarPickerState =
  | { status: "idle" }
  | {
      status: "loading";
      request: number;
    }
  | { status: "editing"; source: AvatarSource }
  | { status: "failed"; message: string };

type AvatarPickerEvent =
  | { type: "load"; request: number }
  | {
      type: "loaded";
      request: number;
      source: AvatarSource | null;
    }
  | { type: "failed"; request: number; message: string }
  | { type: "pick"; source: AvatarSource }
  | { type: "close" };

export function transitionAvatarPicker(
  state: AvatarPickerState,
  event: AvatarPickerEvent,
): AvatarPickerState {
  switch (event.type) {
    case "load":
      return {
        status: "loading",
        request: event.request,
      };
    case "loaded":
      if (state.status !== "loading" || event.request !== state.request)
        return state;
      return event.source
        ? { status: "editing", source: event.source }
        : { status: "idle" };
    case "failed":
      return state.status === "loading" && event.request === state.request
        ? { status: "failed", message: event.message }
        : state;
    case "pick":
      return { status: "editing", source: event.source };
    case "close":
      return { status: "idle" };
  }
}
