import type { ReactNode } from 'react';

export interface DialogDescriptionProps {
  children: ReactNode;
}

export function DialogDescription({ children }: DialogDescriptionProps) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}
