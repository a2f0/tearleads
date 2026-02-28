import { Children, type ReactNode } from 'react';

export interface VehiclesPageProps {
  title?: ReactNode;
  backLink?: ReactNode;
  children?: ReactNode;
}

export function VehiclesPage({
  title = 'Vehicles',
  backLink,
  children
}: VehiclesPageProps) {
  const normalizedChildren =
    Children.toArray(children).length > 0 ? children : null;

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="flex flex-col gap-2 pb-4">
        {backLink}
        <h1 className="font-bold text-xl tracking-tight sm:text-2xl">
          {title}
        </h1>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border p-3">
        {normalizedChildren}
      </div>
    </div>
  );
}
