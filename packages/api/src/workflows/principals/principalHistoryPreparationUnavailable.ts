import { PrincipalPolicyError } from "./shared";

/** Only bounded preparation after transaction rollback may emit this refusal. */
export class PrincipalHistoryPreparationUnavailable extends PrincipalPolicyError {
  constructor(message: string) {
    super(message, 503);
  }
}
