/**
 * Shapes of registered protocol negative controls. Kept apart from the
 * registry in protocolNegativeControls.ts so the per-area control modules it
 * aggregates can import them without an import cycle.
 */

export type ExpectedViolation =
  | { readonly kind: "invariant"; readonly name: string }
  | { readonly kind: "action"; readonly name: string }
  | { readonly kind: "liveness"; readonly name: string };

export interface NegativeControl {
  readonly id: string;
  /** Repository-relative module path. */
  readonly module: string;
  /** Repository-relative registered configuration the control derives from. */
  readonly config: string;
  /** Constant assignments that replace the registered values. */
  readonly constants: Readonly<Record<string, string>>;
  readonly expect: ExpectedViolation;
  readonly why: string;
}
