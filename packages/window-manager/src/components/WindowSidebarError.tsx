export interface WindowSidebarErrorProps {
  message: string;
}

export function WindowSidebarError({ message }: WindowSidebarErrorProps) {
  return (
    <div className="px-2 py-4 text-center text-destructive text-xs">
      {message}
    </div>
  );
}
