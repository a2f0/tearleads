/**
 * This invocation reached neither mutation nor persistence/recovery work.
 * It says nothing about earlier attempts; unknown errors remain uncertain.
 * Throw only at a proven pre-effect boundary, never from shared postchecks.
 */
export class ContactAddressWriteRefusal extends Error {}
