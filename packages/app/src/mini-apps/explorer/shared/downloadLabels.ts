export const EXPLORER_DOWNLOAD_LABELS = {
  downloadsAction: "Downloads",
  downloadsDescription:
    "Known documents and folder metadata waiting to download. More items may appear as folders are discovered.",
  downloadsEmpty: "No pending downloads.",
  downloadsLoading: "Loading downloads...",
  downloadsUnknownDocument: "Document awaiting content",
  downloadsUnknownFolder: "Folder awaiting metadata",
  downloadsWaiting: "Waiting to download",
  downloadsRunning: "Downloading",
  downloadsRemaining: "More pages pending",
  downloadsOffline: "Waiting for connection",
  downloadsSignIn: "Waiting for sign-in",
  downloadsError: "Sync error",
  downloadsItemColumn: "Item",
  downloadsStatusColumn: "Status",
  downloadsCountOne: "pending download",
  downloadsCountOther: "pending downloads",
} as const;

const COUNT_FORMATTER = new Intl.NumberFormat();
const PLURAL_RULES = new Intl.PluralRules();

export function getExplorerDownloadsCountLabel(value: number): string {
  const label =
    PLURAL_RULES.select(value) === "one"
      ? EXPLORER_DOWNLOAD_LABELS.downloadsCountOne
      : EXPLORER_DOWNLOAD_LABELS.downloadsCountOther;
  return `${COUNT_FORMATTER.format(value)} ${label}`;
}
