export function DefaultInlineUnlock({ description }: { description?: string }) {
  return (
    <div className="rounded-md border border-dashed p-4 text-muted-foreground text-sm">
      Unlock your database to use {description}.
    </div>
  );
}
