declare namespace NodeJS {
  interface Process {
    _getActiveHandles?: () => unknown[];
    _getActiveRequests?: () => unknown[];
  }
}
