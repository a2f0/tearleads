import type { InlineUnlockProps } from './WalletRuntimeContext';

export function DefaultInlineUnlock({ description }: InlineUnlockProps) {
  return (
    <div className="rounded-md border border-dashed p-4 text-muted-foreground text-sm">
      Unlock your database to use {description}.
    </div>
  );
}
