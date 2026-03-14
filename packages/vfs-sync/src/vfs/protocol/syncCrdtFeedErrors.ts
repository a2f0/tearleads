export type VfsCrdtFeedOrderViolationCode =
  | 'invalidOccurredAt'
  | 'missingOpId'
  | 'duplicateOpId'
  | 'outOfOrderRow'
  | 'invalidLinkPayload'
  | 'invalidEncryptedEnvelope';

export class VfsCrdtFeedOrderViolationError extends Error {
  readonly code: VfsCrdtFeedOrderViolationCode;
  readonly rowIndex: number;

  constructor(
    code: VfsCrdtFeedOrderViolationCode,
    rowIndex: number,
    message: string
  ) {
    super(message);
    this.name = 'VfsCrdtFeedOrderViolationError';
    this.code = code;
    this.rowIndex = rowIndex;
  }
}
