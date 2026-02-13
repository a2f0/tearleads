export type {
  BusinessIdentifierError,
  BusinessIdentifierField,
  BusinessIdentifiers,
  BusinessIdentifiersInput,
  BusinessIdentifiersValidationResult,
  IdentifierValidationResult
} from './lib/business-identifiers.js';
export {
  DUNS_DIGIT_COUNT,
  EIN_DIGIT_COUNT,
  formatDunsNumber,
  formatEin,
  isDunsNumber,
  isEin,
  normalizeBusinessIdentifiers,
  normalizeDunsNumber,
  normalizeEin,
  validateDunsNumber,
  validateEin
} from './lib/business-identifiers.js';
