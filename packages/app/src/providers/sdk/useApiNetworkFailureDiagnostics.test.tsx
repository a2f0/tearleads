import { afterEach, expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { apiNetworkFailureTags } from "@tearleads/diagnostics/network";
import { protocolOperations } from "@tearleads/validators/operation";
import { cleanup, render } from "@testing-library/react";
import {
  type ApiNetworkFailureInput,
  type AppDiagnostics,
  apiRouteTemplates,
} from "../../host/AppDiagnostics";
import { useApiNetworkFailureDiagnostics } from "./useApiNetworkFailureDiagnostics";

afterEach(cleanup);

type ApiNetworkFailureDetails = Parameters<
  Parameters<Tearleads["subscribeApiNetworkFailures"]>[0]
>[0];

const details: ApiNetworkFailureDetails = {
  classification: "offline",
  hint: "this device reports no network connection",
  method: "GET",
  pathTemplate: "/auth/sessions",
  apiOrigin: "https://api.tearleads.com",
  pageOrigin: "https://app.tearleads.com",
  crossOrigin: true,
  preflight: true,
  attempt: 1,
  elapsedMs: 3,
  online: false,
  errorName: "TypeError",
  errorMessage: "Failed to fetch",
  causeName: null,
  causeMessage: null,
  probe: "not-run",
};

function fakeSubscription() {
  const listeners = new Set<(failure: ApiNetworkFailureDetails) => void>();
  let subscriptions = 0;
  return {
    subscribe: (listener: (failure: ApiNetworkFailureDetails) => void) => {
      subscriptions++;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: () => {
      for (const listener of listeners) listener(details);
    },
    get listeners() {
      return listeners.size;
    },
    get subscriptions() {
      return subscriptions;
    },
  };
}

function Probe(props: {
  subscribe: ReturnType<typeof fakeSubscription>["subscribe"];
  diagnostics: AppDiagnostics | undefined;
}) {
  useApiNetworkFailureDiagnostics(
    { subscribeApiNetworkFailures: props.subscribe },
    props.diagnostics,
  );
  return null;
}

test("failures reach host diagnostics until unmount", () => {
  const source = fakeSubscription();
  const reported: ApiNetworkFailureInput[] = [];
  const registered: ReadonlySet<string>[] = [];
  const view = render(
    <Probe
      subscribe={source.subscribe}
      diagnostics={{
        addBreadcrumb: () => {},
        captureError: () => {},
        reportApiNetworkFailure: (failure) => reported.push(failure),
        setApiRouteTemplates: (routes) => registered.push(routes),
      }}
    />,
  );
  source.emit();
  expect(reported).toEqual([details]);
  expect(registered).toEqual([apiRouteTemplates]);
  view.unmount();
  expect(source.listeners).toBe(0);
});

test("nothing subscribes when Sentry is disabled or cannot take network reports", () => {
  const source = fakeSubscription();
  render(<Probe subscribe={source.subscribe} diagnostics={undefined} />);
  render(
    <Probe
      subscribe={source.subscribe}
      diagnostics={{ addBreadcrumb: () => {}, captureError: () => {} }}
    />,
  );
  source.emit();
  expect(source.subscriptions).toBe(0);
});

test("every registered operation's path template is reported as itself", () => {
  const paths: string[] = protocolOperations.map((operation) => operation.path);
  expect(new Set(paths)).toEqual(new Set(apiRouteTemplates));
  const coarsened = paths.filter(
    (path) =>
      apiNetworkFailureTags(
        { ...details, pathTemplate: path },
        "https://app.tearleads.com",
        apiRouteTemplates,
      )?.api_network_route !== path,
  );
  expect(coarsened).toEqual([]);
  expect(
    apiNetworkFailureTags(
      { ...details, pathTemplate: "/containers/private-document" },
      "https://app.tearleads.com",
      apiRouteTemplates,
    )?.api_network_route,
  ).toBe("other");
});
