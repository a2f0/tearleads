import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { ClipboardIcon } from "@phosphor-icons/react/dist/csr/Clipboard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCurrentWindow } from "../../../components/window/CurrentWindowContext";
import { useWindowTitleBarAction } from "../../../components/window/WindowMenuContext";

const COPY_REPORT_LABEL = "Copy report for support";
const CLIPBOARD_COPIED_STATUS_TEXT = "Successfully copied to clipboard";
const CLIPBOARD_COPIED_STATE_DURATION_MS = 1200;
const COPY_REPORT_ICON = <ClipboardIcon aria-hidden size={18} />;
const COPIED_ICON = <CheckIcon aria-hidden size={18} />;

/** Registers the full support report in the shared window/routed toolbar. */
export function useSystemMonitorCopyReportAction(
  buildReport: () => string,
): void {
  const currentWindow = useCurrentWindow();
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }

    const report = buildReport();
    if (report.trim().length === 0) {
      return;
    }

    void navigator.clipboard
      .writeText(report)
      .then(() => {
        if (!mountedRef.current) {
          return;
        }
        if (copiedTimeoutRef.current) {
          clearTimeout(copiedTimeoutRef.current);
        }
        setCopied(true);
        currentWindow?.showStatusMessage(CLIPBOARD_COPIED_STATUS_TEXT);
        copiedTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) {
            setCopied(false);
          }
          copiedTimeoutRef.current = null;
        }, CLIPBOARD_COPIED_STATE_DURATION_MS);
      })
      .catch(() => undefined);
  }, [buildReport, currentWindow]);

  const action = useMemo(
    () => ({
      icon: copied ? COPIED_ICON : COPY_REPORT_ICON,
      id: "system-monitor-copy-report",
      label: COPY_REPORT_LABEL,
      onClick: handleCopy,
      priority: 100,
    }),
    [copied, handleCopy],
  );

  useWindowTitleBarAction(action);
}
