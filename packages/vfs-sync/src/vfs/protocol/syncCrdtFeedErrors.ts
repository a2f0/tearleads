export type VfsCrdtFeedOrderViolationCode =
  | 'invalidOccurredAt'
  | 'missingOpId'
  | 'duplicateOpId'
  | 'outOfOrderRow'
  | 'invalidLinkPayload'
  | 'invalidEncryptedEnvelope';

export class VfsCrdtFeedOrderViolationError extends Error {
  constructor(
    code: VfsCrdtFeedOrderViolationCode,
    rowIndex: number,
    message: string
  ) {
    super(message);
    this.name = 'VfsCrdtFeedOrderViolationError';
    Object.defineProperties(this, {
      code: {
        value: code,
        enumerable: true,
        configurable: false,
        writable: false
      },
      rowIndex: {
        value: rowIndex,
        enumerable: true,
        configurable: false,
        writable: false
      }
    });
  }
}
