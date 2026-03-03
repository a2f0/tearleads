import * as apiClientEntry from '@tearleads/api-client/clientEntry';
import * as analytics from '@/db/analytics';
import { getActiveOrganizationId } from '@/lib/orgStorage';

export { openChatCompletions } from '@tearleads/api-client/chatCompletions';
export { openNotificationEventStream } from '@tearleads/api-client/notificationStream';

function readOptionalExport<TValue>(getter: () => TValue): TValue | undefined {
  try {
    return getter();
  } catch {
    return undefined;
  }
}

const setApiEventLogger = readOptionalExport(
  () => apiClientEntry.setApiEventLogger
);
const setApiRequestHeadersProvider = readOptionalExport(
  () => apiClientEntry.setApiRequestHeadersProvider
);
const logApiEvent = readOptionalExport(() => analytics.logApiEvent);

if (
  typeof setApiEventLogger === 'function' &&
  typeof logApiEvent === 'function'
) {
  setApiEventLogger(logApiEvent);
}

if (typeof setApiRequestHeadersProvider === 'function') {
  setApiRequestHeadersProvider(() => {
    const organizationId = getActiveOrganizationId();
    if (organizationId === null) {
      return undefined;
    }

    return {
      'X-Organization-Id': organizationId
    };
  });
}

const { API_BASE_URL, api, tryRefreshToken } = apiClientEntry;

export { api, API_BASE_URL, tryRefreshToken };
