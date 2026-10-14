import { reportService } from "../services/reportService";
import { invalidatePortalData } from "../services/dataAccess";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AuthProvider, useAuth } from "../auth/AuthContext";
import { canAccessNav } from "../auth/permissions";
import { NAV_ITEMS, type NavItemId } from "../constants/routes";
import { useDashboardData } from "../hooks/useDashboardData";
import { useFleetFilters } from "../hooks/useFleetFilters";
import { ChangePasswordForm } from "../components/auth/ChangePasswordForm";
import { LoginForm } from "../components/auth/LoginForm";
import { GlobalFilters } from "../components/filters/GlobalFilters";
import { MobileNav } from "../components/layout/MobileNav";
import { DesktopNav } from "../components/layout/DesktopNav";
import { TopBar } from "../components/layout/TopBar";










import { LoadingState } from "../components/ui/LoadingState";
import { Panel } from "../components/ui/Panel";
import { TimingToast } from "../components/ui/TimingToast";
import { ErrorBoundary } from "../components/ui/ErrorBoundary";
import { invalidateLiveOemCaches, refreshLiveOemData } from "../services/adapters/volvoRfmsAdapter";

const AdminNotificationsDashboard = lazy(() => import("../components/dashboard/AdminNotificationsDashboard").then((module) => ({ default: module.AdminNotificationsDashboard })));
const FleetDashboard = lazy(() => import("../components/dashboard/FleetDashboard").then((module) => ({ default: module.FleetDashboard })));
const IntegrationsDashboard = lazy(() => import("../components/dashboard/IntegrationsDashboard").then((module) => ({ default: module.IntegrationsDashboard })));
const ManagementDashboard = lazy(() => import("../components/dashboard/ManagementDashboard").then((module) => ({ default: module.ManagementDashboard })));
const MasterDataDashboard = lazy(() => import("../components/dashboard/MasterDataDashboard").then((module) => ({ default: module.MasterDataDashboard })));
const EquipmentMasterDashboard = lazy(() => import("../components/dashboard/EquipmentMasterDashboard").then((module) => ({ default: module.EquipmentMasterDashboard })));
const NotificationCenterDashboard = lazy(() => import("../components/dashboard/NotificationCenterDashboard").then((module) => ({ default: module.NotificationCenterDashboard })));
const ReportsDashboard = lazy(() => import("../components/dashboard/ReportsDashboard").then((module) => ({ default: module.ReportsDashboard })));
const SettingsDashboard = lazy(() => import("../components/dashboard/SettingsDashboard").then((module) => ({ default: module.SettingsDashboard })));
const UserManagementDashboard = lazy(() => import("../components/dashboard/UserManagementDashboard").then((module) => ({ default: module.UserManagementDashboard })));
const WhatsAppDeliveryDashboard = lazy(() => import("../components/dashboard/WhatsAppDeliveryDashboard").then((module) => ({ default: module.WhatsAppDeliveryDashboard })));

export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}

function AppContent() {
  const { currentUser, loading, logout } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-coal-50">
        <LoadingState />
      </div>
    );
  }

  if (!currentUser) {
    return <LoginForm />;
  }

  if (currentUser.mustChangePassword) {
    return <ChangePasswordForm />;
  }

  return <DashboardShell onLogout={logout} />;
}

function DashboardShell({ onLogout }: { onLogout: () => void }) {
  const [desktopLayout, setDesktopLayout] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktopLayout(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const { currentUser } = useAuth();
  const [activeSection, setActiveSection] = useState<NavItemId>(() => initialSectionFromUrl());
  const [refreshKey, setRefreshKey] = useState(0);
  const [timingNotice, setTimingNotice] = useState<{
    id: number;
    elapsedMs: number;
    message: string;
  } | null>(null);
  const sectionTimerRef = useRef<{ section: NavItemId; startedAt: number } | null>(null);
  const { filters, setFilter, setFilters, resetFilters, options } = useFleetFilters();
  const data = useDashboardData(filters, refreshKey, activeSection);
  const showGlobalFilters = !["users", "notifications", "admin-notifications", "equipment-master"].includes(activeSection);
  const allowedItems = useMemo(
    () => NAV_ITEMS.filter((item) => canAccessNav(currentUser, item.id)),
    [currentUser],
  );
  const reloadDashboard = () => {
    invalidateLiveOemCaches();
    invalidatePortalData();
    reportService.invalidateLiveReportCache();
    setRefreshKey((current) => current + 1);
  };
  const refreshLiveOems = async () => {
    await refreshLiveOemData();
    reloadDashboard();
  };

  useEffect(() => {
    if (!allowedItems.some((item) => item.id === activeSection)) {
      setActiveSection(allowedItems[0]?.id ?? "management");
    }
  }, [activeSection, allowedItems]);

  useEffect(() => {
    const syncSectionFromUrl = () => setActiveSection(initialSectionFromUrl());
    window.addEventListener("popstate", syncSectionFromUrl);
    return () => window.removeEventListener("popstate", syncSectionFromUrl);
  }, []);

  useEffect(() => {
    if (data.loading) {
      return;
    }

    const pendingTimer = sectionTimerRef.current;
    if (!pendingTimer || pendingTimer.section !== activeSection) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setTimingNotice({
        id: Date.now(),
        elapsedMs: performance.now() - pendingTimer.startedAt,
        message: "Data loaded",
      });
      sectionTimerRef.current = null;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeSection, data.loading]);

  if (!currentUser) {
    return null;
  }

  const showTimingNotice = (message: string, elapsedMs: number) => {
    setTimingNotice({
      id: Date.now(),
      elapsedMs,
      message,
    });
  };

  const handleSectionChange = (section: NavItemId) => {
    const targetUrl = section === "reports" ? "/reports" : `/?section=${section}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (currentUrl !== targetUrl) {
      window.history.pushState({}, "", targetUrl);
    }
    if (section === "reports" && section === activeSection) {
      window.dispatchEvent(new Event("reports:root"));
    }

    if (section !== activeSection) {
      sectionTimerRef.current = { section, startedAt: performance.now() };
      setTimingNotice(null);
      setActiveSection(section);
    }
  };

  return (
    <div className="fms-theme min-h-screen">
      <DesktopNav
        active={activeSection}
        onChange={handleSectionChange}
        items={allowedItems}
        userControls={desktopLayout && <TopBar compact user={currentUser} onLogout={onLogout} onOpenNotifications={() => handleSectionChange("notifications")} />}
        onReportChange={(path) => {
          handleSectionChange("reports");
          if (path !== "/reports") {
            window.history.replaceState({}, "", path);
            window.dispatchEvent(new Event("reports:root"));
          }
        }}
      />
      <main>
        {!desktopLayout && <TopBar user={currentUser} onLogout={onLogout} onOpenNotifications={() => handleSectionChange("notifications")} />}
        <div className="flex flex-col items-start lg:flex-row">
        {showGlobalFilters && (
          <GlobalFilters
            filters={filters}
            options={options}
            setFilter={setFilter}
            setFilters={setFilters}
            resetFilters={resetFilters}
            onRefresh={reloadDashboard}
          />
        )}
        <div className="min-w-0 w-full flex-1 px-4 py-4 lg:px-6">
          <div className="mb-4">
            <MobileNav active={activeSection} onChange={handleSectionChange} items={allowedItems} />
          </div>
          {data.error ? (
            <Panel title="Unable to load dashboard">
              <p className="text-sm text-red-700">{data.error}</p>
            </Panel>
          ) : (
            <Suspense fallback={<LoadingState />}>{renderSection(
              activeSection,
              data,
              filters,
              refreshKey,
              showTimingNotice,
              reloadDashboard,
              setFilters,
              ["Super Admin", "Management", "Fleet Manager"].includes(currentUser.role) ? refreshLiveOems : undefined,
            )}</Suspense>
          )}
        </div>
        </div>
      </main>
      {timingNotice && (
        <TimingToast
          key={timingNotice.id}
          elapsedMs={timingNotice.elapsedMs}
          message={timingNotice.message}
          onClose={() => setTimingNotice(null)}
        />
      )}
    </div>
  );
}

function initialSectionFromUrl(): NavItemId {
  if (window.location.pathname.startsWith("/reports")) {
    return "reports";
  }

  const section = new URLSearchParams(window.location.search).get("section");
  return NAV_ITEMS.some((item) => item.id === section) ? section as NavItemId : "management";
}

function renderSection(
  activeSection: NavItemId,
  data: ReturnType<typeof useDashboardData>,
  filters: ReturnType<typeof useFleetFilters>["filters"],
  refreshKey: number,
  onTimingComplete: (message: string, elapsedMs: number) => void,
  onFleetReload: () => void,
  onFiltersChange: (filters: ReturnType<typeof useFleetFilters>["filters"]) => void,
  onFleetRefresh?: () => Promise<void>,
) {
  switch (activeSection) {
    case "management":
      return <ManagementDashboard overview={data.overview} loading={data.loading} />;
    case "fleet":
      return <FleetDashboard rows={data.fleetRows} alerts={data.alerts} loading={data.loading} onReload={onFleetReload} onRefresh={onFleetRefresh} />;
    case "reports":
      return (
        <ReportsDashboard
          onFiltersChange={onFiltersChange}
          reports={data.reports}
          filters={filters}
          loading={data.loading}
          refreshKey={refreshKey}
          onTimingComplete={onTimingComplete}
        />
      );
    case "notifications":
      return <NotificationCenterDashboard />;
    case "admin-notifications":
      return <AdminNotificationsDashboard />;
    case "integrations":
      return <IntegrationsDashboard integrations={data.integrations} loading={data.loading} />;
    case "whatsapp":
      return (
        <WhatsAppDeliveryDashboard
          schedules={data.whatsAppSchedules}
          logs={data.whatsAppDeliveryLogs}
          filters={filters}
          loading={data.loading}
        />
      );
    case "master-data":
      return <MasterDataDashboard fleetRows={data.fleetRows} loading={data.loading} />;
    case "equipment-master":
      return <EquipmentMasterDashboard />;
    case "users":
      return <UserManagementDashboard />;
    case "settings":
      return <SettingsDashboard />;
    default:
      return <ManagementDashboard overview={data.overview} loading={data.loading} />;
  }
}
