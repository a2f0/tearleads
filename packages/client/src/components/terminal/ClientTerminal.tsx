import {
  Terminal as TerminalBase,
  type TerminalUtilities
} from '@tearleads/terminal';
import { useDatabaseContext } from '@/db/hooks';
import { getErrorMessage } from '@/lib/errors';
import {
  generateBackupFilename,
  readFileAsUint8Array,
  saveFile
} from '@/lib/file-utils';

interface ClientTerminalProps {
  className?: string;
  autoFocus?: boolean;
}

const terminalUtilities: TerminalUtilities = {
  getErrorMessage,
  generateBackupFilename,
  readFileAsUint8Array,
  saveFile
};

export function ClientTerminal({
  className,
  autoFocus = true
}: ClientTerminalProps) {
  const db = useDatabaseContext();

  return (
    <TerminalBase
      db={db}
      utilities={terminalUtilities}
      autoFocus={autoFocus}
      {...(className ? { className } : {})}
    />
  );
}
