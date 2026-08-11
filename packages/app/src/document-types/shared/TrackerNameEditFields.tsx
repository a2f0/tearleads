import type { ReactNode } from "react";
import { MiniAppInput } from "../../components/mini-app/MiniAppLayout";
import {
  StructuredDocumentField,
  StructuredDocumentFields,
} from "./StructuredDocument";

interface TrackerNameEditFieldsProps {
  readonly ariaLabel: string;
  readonly children?: ReactNode;
  readonly controlsDisabled: boolean;
  readonly inputId: string;
  readonly label: string;
  readonly onRename: (value: string) => void;
  readonly placeholder: string;
  readonly ready: boolean;
  readonly value: string;
}

/**
 * The tracker edit pane's name field. Every tracker document names itself the
 * same way, differing only in strings; per-type extras render after it.
 */
export function TrackerNameEditFields(props: TrackerNameEditFieldsProps) {
  return (
    <StructuredDocumentFields>
      <StructuredDocumentField inputId={props.inputId} label={props.label}>
        <MiniAppInput
          id={props.inputId}
          aria-label={props.ariaLabel}
          value={props.value}
          onChange={(event) => props.onRename(event.target.value)}
          placeholder={props.ready ? props.placeholder : "Loading..."}
          disabled={props.controlsDisabled}
          autoComplete="off"
        />
      </StructuredDocumentField>
      {props.children}
    </StructuredDocumentFields>
  );
}
