import type { ReactNode } from 'react';

export interface DialogTitleProps {
  children: ReactNode;
}

export function DialogTitle({ children }: DialogTitleProps) {
  return <h2 className="font-semibold text-lg">{children}</h2>;
}
