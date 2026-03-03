import {
  API_BASE_URL,
  api,
  setApiEventLogger,
  setApiRequestHeadersProvider,
  tryRefreshToken
} from '@tearleads/api-client';
import { logApiEvent } from '@/db/analytics';
import { getActiveOrganizationId } from '@/lib/orgStorage';

export { openChatCompletions } from '@tearleads/api-client/chatCompletions';
export { openNotificationEventStream } from '@tearleads/api-client/notificationStream';

setApiEventLogger(logApiEvent);
setApiRequestHeadersProvider(() => {
  const organizationId = getActiveOrganizationId();
  if (organizationId === null) {
    return undefined;
  }

  return {
    'X-Organization-Id': organizationId
  };
});

export { api, API_BASE_URL, tryRefreshToken };
