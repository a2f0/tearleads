interface WalletItemAlertsProps {
  error: string | null;
  successMessage: string | null;
}

export function WalletItemAlerts({
  error,
  successMessage
}: WalletItemAlertsProps) {
  return (
    <>
      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="rounded-lg border border-emerald-600/40 bg-emerald-600/10 p-3 text-emerald-700 text-sm dark:text-emerald-300">
          {successMessage}
        </div>
      )}
    </>
  );
}
