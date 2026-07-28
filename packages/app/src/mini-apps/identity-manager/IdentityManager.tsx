import { useEffect, useState } from "react";
import {
  MiniAppRoot,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import { DestroyKeyPackageConfirmationDialog } from "../../components/shared/DestroyKeyPackageConfirmationDialog";
import { LogoutConfirmationDialog } from "../../components/shared/LogoutConfirmationDialog";
import { useCompactRoutedMode } from "../../navigation/useCompactRoutedMode";
import "./IdentityManager.css";
import { useIdentityManager } from "./IdentityManagerController";
import { IdentityManagerGeneralSection } from "./IdentityManagerGeneralSection";
import { IdentityManagerMenu } from "./IdentityManagerMenu";
import { IdentityManagerPinCodeSection } from "./IdentityManagerPinCodeSection";
import { IdentityManagerRecoveryKeySection } from "./IdentityManagerRecoveryKeySection";
import { SessionDetailSection } from "./IdentityManagerSessionDetail";
import { SessionsSection } from "./IdentityManagerSessions";
import { useIdentityManagerSidebarPanel } from "./IdentityManagerSidebar";
import { IdentitySwitcher } from "./IdentitySwitcher";
import type { IdentityManagerView } from "./routes";
import { useIdentityManagerRoute } from "./useIdentityManagerRoute";

type IdentityManagerModel = ReturnType<typeof useIdentityManager>;

function ActiveSessionsSection({
  model,
  onOpenSessionDetail,
}: {
  model: IdentityManagerModel;
  onOpenSessionDetail: (sessionId: string) => void;
}) {
  const { canManageSessions, sessionList, sessionMutations } = model;

  if (!canManageSessions) {
    return (
      <MiniAppSection>
        <MiniAppSectionHeading>
          <h2>Active Sessions</h2>
        </MiniAppSectionHeading>
        <MiniAppStatus>
          Log in to view and manage active sessions.
        </MiniAppStatus>
      </MiniAppSection>
    );
  }

  return (
    <SessionsSection
      handleEndSession={sessionMutations.endSession}
      loadingSessions={sessionList.loadingSessions}
      mutatingSessionId={sessionMutations.mutatingSessionId}
      onOpenSessionDetail={onOpenSessionDetail}
      sessionError={sessionList.sessionError}
      sessions={sessionList.sessions}
    />
  );
}

function IdentityManagerSectionContent({
  model,
  onOpenSessionDetail,
  view,
}: {
  model: IdentityManagerModel;
  onOpenSessionDetail: (sessionId: string) => void;
  view: Exclude<IdentityManagerView, "menu">;
}) {
  if (view === "recovery-key") {
    return <IdentityManagerRecoveryKeySection />;
  }

  if (view === "pin-lock") {
    return <IdentityManagerPinCodeSection />;
  }

  if (view === "active-sessions") {
    return (
      <ActiveSessionsSection
        model={model}
        onOpenSessionDetail={onOpenSessionDetail}
      />
    );
  }

  return <IdentityManagerGeneralSection model={model} />;
}

function IdentityManagerLayout(model: IdentityManagerModel) {
  const {
    canManageSessions,
    identityMutations,
    identitySwitcher,
    isDestroyKeyPackageDialogOpen,
    logoutBusy,
    logoutDialog,
    onConfirmLogout,
    sessionList,
    sessionMutations,
  } = model;
  const route = useIdentityManagerRoute();
  const compactRoutedMode = useCompactRoutedMode();
  const view: IdentityManagerView =
    route.isRouted && !compactRoutedMode && route.view === "menu"
      ? "general"
      : route.view;
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const selectedSession =
    sessionList.sessions.find(
      (candidate) => candidate.id === selectedSessionId,
    ) ?? null;
  const hasSelectedSession = selectedSession !== null;

  useEffect(() => {
    if (
      selectedSessionId !== null &&
      (view !== "active-sessions" || !canManageSessions || !hasSelectedSession)
    ) {
      setSelectedSessionId(null);
    }
  }, [canManageSessions, hasSelectedSession, selectedSessionId, view]);

  useIdentityManagerSidebarPanel({ setView: route.setView, view });

  return (
    <MiniAppRoot className="identity-manager">
      <IdentitySwitcher switcher={identitySwitcher} />
      <main className="identity-manager-main">
        {view === "active-sessions" && canManageSessions && selectedSession ? (
          <SessionDetailSection
            handleEndSession={sessionMutations.endSession}
            mutatingSessionId={sessionMutations.mutatingSessionId}
            onBack={() => setSelectedSessionId(null)}
            session={selectedSession}
          />
        ) : view === "menu" ? (
          <IdentityManagerMenu setView={route.setView} />
        ) : (
          <IdentityManagerSectionContent
            model={model}
            onOpenSessionDetail={setSelectedSessionId}
            view={view}
          />
        )}
      </main>
      {isDestroyKeyPackageDialogOpen && (
        <DestroyKeyPackageConfirmationDialog
          isOpen={isDestroyKeyPackageDialogOpen}
          onCancel={identityMutations.closeDestroyKeyPackageDialog}
          onConfirm={identityMutations.confirmDestroyKeyPackage}
        />
      )}
      {logoutDialog.isOpen && (
        // Mount only while open so the dialog's keep-local-data checkbox resets
        // to its safe default (checked) on every open — a cancelled "wipe"
        // choice must not silently persist into the next logout.
        <LogoutConfirmationDialog
          busy={logoutBusy}
          isOpen={logoutDialog.isOpen}
          onCancel={logoutDialog.closeLogoutDialog}
          onConfirm={onConfirmLogout}
        />
      )}
    </MiniAppRoot>
  );
}

export function IdentityManager() {
  return <IdentityManagerLayout {...useIdentityManager()} />;
}
