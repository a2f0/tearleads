import {
  MiniAppInfoRow,
  MiniAppInfoTable,
} from "../../../components/mini-app/MiniAppTable";
import { useSystemEnvironment } from "./useSystemEnvironment";

export function SystemMonitorEnvironment() {
  const rows = useSystemEnvironment();

  return (
    <section aria-label="System environment" className="pane-content">
      <MiniAppInfoTable className="mini-app-info-table--borderless system-monitor-environment-table">
        <tbody>
          {rows.map((row) => (
            <MiniAppInfoRow key={row.label} label={row.label}>
              <span className="system-monitor-environment-value">
                {row.value}
              </span>
            </MiniAppInfoRow>
          ))}
        </tbody>
      </MiniAppInfoTable>
    </section>
  );
}
