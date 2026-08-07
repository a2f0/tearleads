/**
 * Structural stand-in for a zod schema. Every route operation schema satisfies
 * it, and the Hono validator adapters need nothing beyond `safeParse` (plus the
 * first issue message for query-param error reporting).
 */
export interface SafeParseSchema<Output> {
  safeParse(value: unknown):
    | { readonly data: Output; readonly success: true }
    | {
        readonly error?: {
          readonly issues?: readonly { readonly message: string }[];
        };
        readonly success: false;
      };
}
