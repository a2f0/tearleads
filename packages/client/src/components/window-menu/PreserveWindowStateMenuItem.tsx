import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { usePreserveWindowState } from '@/hooks/usePreserveWindowState';

export function PreserveWindowStateMenuItem() {
  const { preserveWindowState, setPreserveWindowState } =
    usePreserveWindowState();

  return (
    <DropdownMenuItem
      onClick={() => setPreserveWindowState(!preserveWindowState)}
      checked={preserveWindowState}
    >
      Preserve Window State
    </DropdownMenuItem>
  );
}
