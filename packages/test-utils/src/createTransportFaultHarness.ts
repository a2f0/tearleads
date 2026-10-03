import type {
  TransportAttempt,
  TransportFaultHarness,
  TransportFaultStep,
} from "./transportFaultTypes";

let activeGlobalScope = false;

/** Strict request script: nothing reaches a network unless the test delegates it. */
export function createTransportFaultHarness(input: {
  steps: readonly TransportFaultStep[];
  delegate?: (request: Request) => Response | Promise<Response>;
}): TransportFaultHarness {
  const steps = input.steps.map((step) => ({
    ...step,
    method: step.method.toUpperCase(),
    url: new URL(step.url).href,
    action: { ...step.action },
    expectedOutcome:
      step.expectedOutcome ??
      (step.action.kind === "forward" ? "response" : step.action.kind),
  }));
  const attempts: TransportAttempt[] = [];
  let nextStep = 0;
  let scopeController: AbortController | undefined;
  const fetchRequest = async (
    resource: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const step = steps[nextStep];
    const attempt: TransportAttempt = {
      sequence: attempts.length + 1,
      step: step?.name ?? null,
      method: "<unparsed method>",
      url: "<unparsed URL>",
      expectedOutcome: step?.expectedOutcome ?? null,
      outcome: "pending",
      status: null,
      error: null,
    };
    attempts.push(attempt);
    let request: Request;
    try {
      attempt.method = String(
        init?.method ?? (resource instanceof Request ? resource.method : "GET"),
      ).toUpperCase();
      attempt.url =
        resource instanceof Request ? resource.url : String(resource);
      const original = new Request(resource, init);
      request = scopeController
        ? new Request(original, {
            signal: AbortSignal.any([original.signal, scopeController.signal]),
          })
        : original;
    } catch (error) {
      attempt.outcome = "unexpected";
      attempt.error = String(error);
      throw error;
    }
    attempt.method = request.method;
    attempt.url = request.url;
    if (!step || step.method !== request.method || step.url !== request.url) {
      attempt.outcome = "unexpected";
      attempt.error = `Unexpected ${request.method} ${request.url}; expected ${step ? `${step.name}: ${step.method} ${step.url}` : "no more requests"}`;
      throw new Error(attempt.error);
    }
    nextStep += 1;
    try {
      request.signal.throwIfAborted();
      if (step.gate) await step.gate.wait(request.signal);
      request.signal.throwIfAborted();
      if (step.action.kind === "network-error") {
        attempt.outcome = "network-error";
        throw new TypeError(step.action.message ?? "Scripted network failure");
      }
      let response: Response;
      if (step.action.kind === "response") {
        response = step.action.response();
      } else {
        if (!input.delegate) throw new Error(`${step.name}: delegate required`);
        response = await input.delegate(request);
      }
      attempt.status = response.status;
      request.signal.throwIfAborted();
      if (step.action.kind === "lost-response") {
        void response.body?.cancel().catch(() => {});
        attempt.outcome = "lost-response";
        throw new TypeError(step.action.message ?? "Scripted response loss");
      }
      attempt.outcome = "response";
      return response;
    } catch (error) {
      if (request.signal.aborted) attempt.outcome = "aborted";
      else if (attempt.outcome === "pending")
        attempt.outcome = "delegate-error";
      attempt.error = String(error);
      throw error;
    }
  };
  const scriptedFetch: typeof globalThis.fetch = Object.assign(fetchRequest, {
    preconnect: () => {},
  });
  const assertComplete = () => {
    const invalid = attempts.filter(
      (attempt) => attempt.outcome !== attempt.expectedOutcome,
    );
    if (nextStep !== steps.length || invalid.length > 0) {
      throw new Error(
        `Transport script incomplete: ${steps.length - nextStep} unused steps; ${invalid.map((attempt) => `${attempt.sequence}:${attempt.outcome}`).join(", ") || "no invalid attempts"}`,
      );
    }
  };
  return {
    fetch: scriptedFetch,
    get attempts() {
      return attempts.map((attempt) => ({ ...attempt }));
    },
    assertComplete,
    async run(work) {
      if (activeGlobalScope) {
        throw new Error("Transport harness global scopes must run serially");
      }
      activeGlobalScope = true;
      const previousFetch = globalThis.fetch;
      scopeController = new AbortController();
      globalThis.fetch = scriptedFetch;
      try {
        const result = await work();
        assertComplete();
        return result;
      } finally {
        scopeController.abort();
        scopeController = undefined;
        globalThis.fetch = previousFetch;
        activeGlobalScope = false;
      }
    },
  };
}
