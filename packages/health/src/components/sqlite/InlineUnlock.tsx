interface InlineUnlockProps {
  description: string;
}

export function InlineUnlock({ description }: InlineUnlockProps) {
  return (
    <div className="rounded-md border border-dashed p-4 text-muted-foreground text-sm">
      Unlock your database to use {description}.
    </div>
  );
}
