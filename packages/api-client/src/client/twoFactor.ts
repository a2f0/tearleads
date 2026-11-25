import {
  beginTwoFactorSetupOperation,
  disableTwoFactorOperation,
  enableTwoFactorOperation,
  getTwoFactorStatusOperation,
  regenerateTwoFactorRecoveryCodesOperation,
} from "@tearleads/validators/operation";
import type {
  TwoFactorConfirmationRequest,
  TwoFactorEnableRequest,
} from "@tearleads/validators/request";
import type {
  TwoFactorEnableResponse,
  TwoFactorRecoveryCodesResponse,
  TwoFactorSetupResponse,
  TwoFactorStatusResponse,
} from "@tearleads/validators/response";
import { bindPrototypeMethods } from "../requestInternals";
import type { RequestResult } from "../types";
import type { ApiClientContext } from "./apiClientContext";

/**
 * The signed-in identity's own authenticator. Each method returns its
 * status-bearing result, so a caller can read a refusal's `code`.
 */
export class TwoFactorArea {
  constructor(private readonly context: ApiClientContext) {
    bindPrototypeMethods(this, TwoFactorArea.prototype);
  }

  getTwoFactorStatusResult(): Promise<RequestResult<TwoFactorStatusResponse>> {
    return this.context.transport.requestResult(getTwoFactorStatusOperation, {
      params: {},
    });
  }

  beginTwoFactorSetupResult(): Promise<RequestResult<TwoFactorSetupResponse>> {
    return this.context.transport.requestResult(beginTwoFactorSetupOperation, {
      params: {},
    });
  }

  enableTwoFactorResult(
    input: TwoFactorEnableRequest,
  ): Promise<RequestResult<TwoFactorEnableResponse>> {
    return this.context.transport.requestResult(enableTwoFactorOperation, {
      body: input,
      params: {},
    });
  }

  disableTwoFactorResult(
    input: TwoFactorConfirmationRequest,
  ): Promise<RequestResult<TwoFactorStatusResponse>> {
    return this.context.transport.requestResult(disableTwoFactorOperation, {
      body: input,
      params: {},
    });
  }

  regenerateTwoFactorRecoveryCodesResult(
    input: TwoFactorConfirmationRequest,
  ): Promise<RequestResult<TwoFactorRecoveryCodesResponse>> {
    return this.context.transport.requestResult(
      regenerateTwoFactorRecoveryCodesOperation,
      { body: input, params: {} },
    );
  }
}
