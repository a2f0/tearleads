import {
  API_BASE_URL,
  api,
  setApiEventLogger,
  setApiRequestHeadersProvider,
  tryRefreshToken
} from '@tearleads/api-client/clientEntry';
import { logApiEvent } from '@/db/analytics';
import { getActiveOrganizationId } from '@/lib/orgStorage';

export { openChatCompletions } from '@tearleads/api-client/chatCompletions';
export { openNotificationEventStream } from '@tearleads/api-client/notificationStream';

setApiEventLogger(logApiEvent);
setApiRequestHeadersProvider(() => {
  const organizationId = getActiveOrganizationId();
  return organizationId === null
    ? undefined
    : {
        'X-Organization-Id': organizationId
      };
});

export { api, API_BASE_URL, tryRefreshToken };
