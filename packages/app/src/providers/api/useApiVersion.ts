import { useTearleads } from "../sdk/TearleadsProvider";
import { useTearleadsExternalValue } from "../sdk/useTearleadsSubscription";

/** The API build named by the latest response; null until one arrives. */
export function useApiVersion(): number | null {
  const { apiVersion } = useTearleads();
  return useTearleadsExternalValue(
    apiVersion.subscribe,
    () => apiVersion.current,
  );
}
