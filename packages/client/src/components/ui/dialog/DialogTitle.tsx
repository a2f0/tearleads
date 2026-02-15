import type { ReactNode } from 'react';

export interface DialogTitleProps {
  children: ReactNode;
  id?: string;
}

export function DialogTitle({ children, id }: DialogTitleProps) {
  return (
    <h2 id={id} className="font-semibold text-lg">
      {children}
    </h2>
  );
}
