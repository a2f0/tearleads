/**
 * Loro refused an import because it carries an operation id the document
 * already holds with other content. Loro names only the first such id it
 * meets, so the import may reuse more ids than this one.
 */
export class LoroReusedOperationIdError extends Error {
  constructor(
    readonly peerId: `${number}`,
    readonly counter: number,
    cause: unknown,
  ) {
    super(
      `Loro import reuses operation id ${counter}@${peerId} with other content`,
      { cause },
    );
    this.name = "LoroReusedOperationIdError";
  }
}

// Loro throws its errors as bare strings; this is `LoroError::UsedOpID`.
const REUSED_OPERATION_ID =
  /^Every op id should be unique\. ID (\d+)@(\d+) has been used\./u;

function isPeerId(value: string): value is `${number}` {
  return /^\d+$/u.test(value);
}

/**
 * `failure` as a typed error when it is one this package names, and as
 * thrown otherwise.
 */
function typedImportRefusal(failure: unknown): unknown {
  if (typeof failure !== "string") return failure;
  const [, counter, peerId] = REUSED_OPERATION_ID.exec(failure) ?? [];
  if (peerId === undefined || counter === undefined || !isPeerId(peerId)) {
    return failure;
  }
  return new LoroReusedOperationIdError(peerId, Number(counter), failure);
}

/** Runs a Loro import, naming the refusals this package has a type for. */
export function runLoroImport<Result>(importBlob: () => Result): Result {
  try {
    return importBlob();
  } catch (error) {
    throw typedImportRefusal(error);
  }
}
