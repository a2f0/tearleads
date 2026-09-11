import { configureSentry } from "../../src/diagnostics/sentry";

const secret = "SYNTHETIC_PRIVATE_DOCUMENT_KEY";
const diagnostics = configureSentry({
  dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/11`,
  commit: "b".repeat(40),
  environment: "staging",
  variant: "app",
  origin: window.location.origin,
  scriptUrl: import.meta.url,
});
if (!diagnostics) throw new Error("Diagnostic fixture did not initialize");

const button = document.createElement("button");
button.textContent = secret;
button.onclick = () => {
  diagnostics.addBreadcrumb({ area: "explorer", action: "move-to-trash" });
  console.log(secret);
  void fetch(`/api/${secret}`, { method: "POST", body: secret });
  const error = new TypeError(secret);
  Object.assign(error, { cause: new Error(secret), document: { secret } });
  throw error;
};
document.body.append(button);

const rejectionButton = document.createElement("button");
rejectionButton.textContent = "Reject promise";
rejectionButton.onclick = () => {
  diagnostics.addBreadcrumb({ area: "explorer", action: "root-view" });
  void Promise.reject(new Error(secret));
};
document.body.append(rejectionButton);

const handledButton = document.createElement("button");
handledButton.textContent = "Report handled quarantine";
handledButton.onclick = () => {
  const error = new Error(`Document sync quarantined: ${secret}`, {
    cause: new Error(secret),
  });
  Object.assign(error, {
    name: "DocumentSyncUpdateIsolationError",
    documentId: secret,
    writerUserId: secret,
    updateId: secret,
  });
  diagnostics.captureError(error, { area: "app", source: "log" });
};
document.body.append(handledButton);

const primitiveButton = document.createElement("button");
primitiveButton.textContent = "Reject private string";
primitiveButton.onclick = () => {
  void Promise.reject(secret);
};
document.body.append(primitiveButton);

window.addEventListener("unhandledrejection", (event) => {
  if (typeof event.reason === "string") {
    Reflect.set(window, "stringRejectionObserved", true);
  }
});
Reflect.set(window, "disposeDiagnostics", () => diagnostics.dispose());
