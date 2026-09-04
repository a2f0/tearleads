/** Shared SDK/server syntax and canonical-label corpus, including invisible names. */
export const SIGNED_GROUP_NAME_CASES = [
  { name: "Operators", displayName: "Operators", allowed: true },
  { name: " Operators ", displayName: "operators", allowed: true },
  { name: "Ｏｐｅｒａｔｏｒｓ", displayName: "Operators", allowed: true },
  { name: "Café", displayName: "CAFÉ", allowed: true },
  { name: "工程", displayName: "工程", allowed: true },
  { name: null, displayName: "Operators", allowed: false },
  { name: "", displayName: "Operators", allowed: false },
  { name: "   ", displayName: "Operators", allowed: false },
  { name: "Op\u200berators", displayName: "Operators", allowed: false },
  { name: "Op\u202eerators", displayName: "Operators", allowed: false },
  { name: "Op\u0000erators", displayName: "Operators", allowed: false },
  { name: "Op\ud800erators", displayName: "Operators", allowed: false },
  { name: "Op\ufe0ferators", displayName: "Operators", allowed: false },
  { name: "Op\u3164erators", displayName: "Operators", allowed: false },
] as const;

export const SIGNED_GROUP_INVALID_PAYLOADS = [
  "not-base64",
  "eyJuYW1lIjoiT3BlcmF0b3JzIn0=!!",
  "bm90IEpTT04=",
] as const;
