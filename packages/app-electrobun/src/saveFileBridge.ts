// Contract for the renderer -> Bun "save file" bridge. Electrobun's renderer is
// a WKWebView served over a local Bun HTTP server (see src/bun/index.ts), so the
// download action posts the file's bytes to this endpoint on the same origin and
// the Bun main process writes them to the user's Downloads folder. Kept in one
// module both build targets import so the path and header can't drift.

export const ELECTROBUN_SAVE_FILE_PATH = "/__electrobun/save-file";

// The file name travels in a header (URL-encoded) so the request body stays the
// raw file bytes, written as-is with no JSON/base64 envelope.
export const ELECTROBUN_FILE_NAME_HEADER = "x-electrobun-file-name";
