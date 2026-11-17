import type { ContainerNode } from "@tearleads/client-sdk";
import { useEffect, useRef, useState } from "react";
import {
  type PrimaryDocumentSaveEvent,
  type PrimaryDocumentSaveState,
  transitionPrimaryDocumentSave,
} from "./primaryDocumentSaveMachine";

export function usePrimaryDocumentSave(input: {
  containerId: string;
  canManage: boolean;
  setPrimary: (
    containerId: string,
    documentId: string | null,
  ) => Promise<ContainerNode | null>;
  logError: (message: string | Error, cause?: unknown) => void;
}) {
  const [state, setState] = useState<PrimaryDocumentSaveState>({
    status: "idle",
  });
  const current = useRef(state);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const send = (event: PrimaryDocumentSaveEvent) => {
    current.current = transitionPrimaryDocumentSave(current.current, event);
    if (mounted.current) setState(current.current);
  };
  const save = async (documentId: string | null) => {
    if (
      !mounted.current ||
      !input.canManage ||
      current.current.status === "saving"
    )
      return false;
    const request = {};
    send({ type: "save", request });
    try {
      const saved = await input.setPrimary(input.containerId, documentId);
      if (!saved)
        throw new Error(
          "Primary document was not saved. Check container access and document availability.",
        );
      if (!mounted.current) return false;
      send({ type: "saved", request });
      return true;
    } catch (error) {
      input.logError(
        `Failed to set primary document for container ${input.containerId}`,
        error,
      );
      send({
        type: "failed",
        request,
        error:
          error instanceof Error
            ? error.message
            : "Unable to save primary document",
      });
      return false;
    }
  };
  return { state, save };
}
