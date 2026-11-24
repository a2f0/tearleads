import { recoveryKeyQrSvg } from "./recoveryKeyQr";

export interface RecoveryKeyPrintSheet {
  readonly seedPhrase: string;
  readonly signingFingerprint: string | null;
}

const SHEET_TITLE = "Tearleads Recovery Key";

const SHEET_STYLE = `
@page { margin: 18mm; }
:root { color: #000; background: #fff; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
body { margin: 0; }
h1 { margin: 0 0 4mm; font-size: 20pt; }
p { margin: 0 0 4mm; font-size: 11pt; line-height: 1.4; }
.warning { padding: 3mm; border: 1pt solid #000; font-weight: 600; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 1mm 4mm; margin: 0 0 6mm; font-size: 10pt; }
dt { font-weight: 600; }
dd { margin: 0; font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
ol { columns: 3; column-gap: 8mm; margin: 0 0 6mm; padding-left: 8mm; font-family: ui-monospace, monospace; font-size: 13pt; line-height: 1.8; }
figure { margin: 0 0 6mm; break-inside: avoid; }
svg { display: block; width: 60mm; height: 60mm; }
`;

function element<Tag extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: Tag,
  text?: string,
): HTMLElementTagNameMap[Tag] {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Writes the printable sheet into `doc`, replacing its body. */
function buildRecoveryKeySheet(doc: Document, sheet: RecoveryKeyPrintSheet) {
  doc.title = SHEET_TITLE;
  doc.head.append(element(doc, "style", SHEET_STYLE));

  const details = element(doc, "dl");
  const addDetail = (term: string, value: string) =>
    details.append(element(doc, "dt", term), element(doc, "dd", value));
  if (sheet.signingFingerprint) {
    addDetail("Identity", sheet.signingFingerprint);
  }
  addDetail(
    "Printed",
    new Date().toLocaleDateString(undefined, { dateStyle: "long" }),
  );

  const words = element(doc, "ol");
  words.setAttribute("aria-label", "Recovery passphrase");
  for (const word of sheet.seedPhrase.trim().split(/\s+/u)) {
    words.append(element(doc, "li", word));
  }

  const qr = element(doc, "figure");
  // Inline rather than an <img>, which would load asynchronously and could
  // print blank. Parsed as HTML, which places <svg> in the SVG namespace.
  const svg = new DOMParser().parseFromString(
    recoveryKeyQrSvg(sheet.seedPhrase),
    "text/html",
  ).body.firstElementChild;
  if (svg) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Recovery key QR code");
    qr.append(doc.importNode(svg, true));
  }

  const warning = element(
    doc,
    "p",
    "Anyone who reads this page can decrypt your data and impersonate you. Store it somewhere safe and private.",
  );
  warning.className = "warning";

  const main = element(doc, "main");
  main.append(
    element(doc, "h1", SHEET_TITLE),
    warning,
    details,
    words,
    qr,
    element(
      doc,
      "p",
      "To restore this identity on a new device, choose Restore identity, then enter the words in order or choose Restore from QR code. On a device already set up, open Identity Manager → Recovery Key → Recovery.",
    ),
  );
  doc.body.replaceChildren(main);
}

/** The frame holding the last sheet sent to print, until its dialog closes. */
let printFrame: HTMLIFrameElement | null = null;

/**
 * Removes the sheet last sent to print, and the key it holds. Revoking a
 * disclosure calls it too, in case the dialog never reported closing.
 */
export function discardRecoveryKeyPrint() {
  printFrame?.remove();
  printFrame = null;
}

/**
 * Prints the recovery key on a sheet of its own: the numbered words, the QR
 * code the Recovery tab scans, and how to restore from them. The sheet is
 * built in a hidden same-origin frame, so the printout never captures the app
 * around it. The frame holds the key in its DOM, so it is removed once the
 * print dialog closes, when the disclosure is revoked, or at the latest when
 * the next print replaces it.
 */
export function printRecoveryKey(sheet: RecoveryKeyPrintSheet): void {
  discardRecoveryKeyPrint();
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.append(frame);
  printFrame = frame;
  try {
    const frameWindow = frame.contentWindow;
    const frameDocument = frame.contentDocument;
    if (!frameWindow || !frameDocument) {
      throw new Error("Printing is unavailable on this device.");
    }
    buildRecoveryKeySheet(frameDocument, sheet);
    frameWindow.addEventListener(
      "afterprint",
      () => {
        if (printFrame === frame) discardRecoveryKeyPrint();
      },
      { once: true },
    );
    frameWindow.focus();
    frameWindow.print();
  } catch (error) {
    discardRecoveryKeyPrint();
    throw error;
  }
}
