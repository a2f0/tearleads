import type { ReactNode } from 'react';
import {
  type EmailBodyOperations,
  type EmailContactOperations,
  type EmailDatabaseState,
  type EmailDraftOperations,
  type EmailFolderOperations,
  EmailProvider,
  type EmailUIComponents
} from '../context';
import { mockUIComponents } from './mockUIComponents';

interface TestEmailProviderProps {
  children: ReactNode;
  apiBaseUrl?: string;
  databaseState?: EmailDatabaseState;
  getAuthHeader?: () => string | null;
  ui?: EmailUIComponents;
  contactOperations?: EmailContactOperations;
  folderOperations?: EmailFolderOperations;
  bodyOperations?: EmailBodyOperations;
  draftOperations?: EmailDraftOperations;
}

export function TestEmailProvider({
  children,
  apiBaseUrl = 'http://localhost:5001/v1',
  databaseState = {
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: null
  },
  getAuthHeader,
  ui = mockUIComponents,
  contactOperations,
  folderOperations,
  bodyOperations,
  draftOperations
}: TestEmailProviderProps) {
  return (
    <EmailProvider
      apiBaseUrl={apiBaseUrl}
      databaseState={databaseState}
      ui={ui}
      {...(getAuthHeader !== undefined && { getAuthHeader })}
      {...(contactOperations !== undefined && { contactOperations })}
      {...(folderOperations !== undefined && { folderOperations })}
      {...(bodyOperations !== undefined && { bodyOperations })}
      {...(draftOperations !== undefined && { draftOperations })}
    >
      {children}
    </EmailProvider>
  );
}
