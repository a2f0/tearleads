import { describeSchema } from "../jsonSchemaAnnotations";
import {
  TwoFactorConfirmationRequestSchema,
  TwoFactorEnableRequestSchema,
  TwoFactorLoginCodeSchema,
  UpdateOrganizationRosterTwoFactorRequestSchema,
} from "../request";
import {
  TwoFactorEnableResponseSchema,
  TwoFactorErrorResponseSchema,
  TwoFactorRecoveryCodesResponseSchema,
  TwoFactorSetupResponseSchema,
  TwoFactorStatusResponseSchema,
} from "../response";

describeSchema(
  TwoFactorLoginCodeSchema,
  "A second factor sent with sign-in by an identity that has two-factor on.",
  {
    code: "The authenticator's current six-digit code, or an unused recovery code.",
    method:
      "`totp` for an authenticator code, `recovery_code` for a recovery code.",
    rememberDevice:
      "True to receive a device token, so this device's sign-ins need no code for thirty days.",
  },
);

describeSchema(
  TwoFactorEnableRequestSchema,
  "Confirms a pending authenticator with its current code, turning two-factor on.",
  {
    code: "The authenticator's current six-digit code.",
    rememberDevice:
      "True to also receive a device token for this device's later sign-ins.",
  },
);

describeSchema(
  TwoFactorConfirmationRequestSchema,
  "Proves the second factor again before turning it off or replacing the recovery codes.",
  {
    code: "An authenticator code or an unused recovery code.",
    method:
      "`totp` for an authenticator code, `recovery_code` for a recovery code.",
  },
);

describeSchema(
  TwoFactorStatusResponseSchema,
  "The signed-in identity's two-factor state and the calling session's standing.",
);

describeSchema(
  TwoFactorSetupResponseSchema,
  "A new authenticator secret, pending until a code confirms it.",
);

describeSchema(
  TwoFactorEnableResponseSchema,
  "Two-factor is on: the recovery codes, shown once, and the device token if one was asked for.",
);

describeSchema(
  TwoFactorRecoveryCodesResponseSchema,
  "New recovery codes, shown once; the previous codes no longer work.",
);

describeSchema(
  TwoFactorErrorResponseSchema,
  "A refused two-factor management request.",
  {
    code: "Why it was refused, such as `two_factor_invalid` for a code that did not match.",
  },
);

describeSchema(
  UpdateOrganizationRosterTwoFactorRequestSchema,
  "An administrator's two-factor requirement for one member.",
  {
    required:
      "True to refuse the member's sessions that did not pass a second factor.",
  },
);
