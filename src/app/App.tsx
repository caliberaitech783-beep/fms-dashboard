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
import { Sidebar } from "../components/layout/Sidebar";
import { TopBar } from "../components/layout/TopBar";
import { LoadingState } from "../components/ui/LoadingState";
import { Panel } from "../components/ui/Panel";
import { TimingToast } from "../components/ui/TimingToast";
import { ErrorBoundary } from "../components/ui/ErrorBoundary";

const AlertsDashboard = lazy(() => import("../components/dashboard/AlertsDashboard").then((module) => ({ default: module.AlertsDashboard })));
const AdminNotificationsDashboard = lazy(() => import("../components/dashboard/AdminNotificationsDashboard").then((module) => ({ default: module.AdminNotificationsDashboard })));
const DieselDashboard = lazy(() => import("../components/dashboard/DieselDashboard").then((module) => ({ default: module.DieselDashboard })));
const FleetDashboard = lazy(() => import("../components/dashboard/FleetDashboard").then((module) => ({ default: module.FleetDashboard })));
const FuelDashboard = lazy(() => import("../components/dashboard/FuelDashboard").then((module) => ({ default: module.FuelDashboard })));
const IntegrationsDashboard = lazy(() => import("../components/dashboard/IntegrationsDashboard").then((module) => ({ default: module.IntegrationsDashboard })));
const ManagementDashboard = lazy(() => import("../components/dashboard/ManagementDashboard").then((module) => ({ default: module.ManagementDashboard })));
const MasterDataDashboard = lazy(() => import("../components/dashboard/MasterDataDashboard").then((module) => ({ default: module.MasterDataDashboard })));
const NotificationCenterDashboard = lazy(() => import("../components/dashboard/NotificationCenterDashboard").then((module) => ({ default: module.NotificationCenterDashboard })));
const ProductionDashboard = lazy(() => import("../components/dashboard/ProductionDashboard").then((module) => ({ default: module.ProductionDashboard })));
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
  const { currentUser } = useAuth();
  const [activeSection, setActiveSection] = useState<NavItemId>(() => {
    const requested = initialSectionFromUrl();
    if (canAccessNav(currentUser, requested)) {
      return requested;
    }
    return NAV_ITEMS.find((item) => canAccessNav(currentUser, item.id))?.id ?? "management";
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [timingNotice, setTimingNotice] = useState<{
    id: number;
    elapsedMs: number;
    message: string;
  } | null>(null);
  const sectionTimerRef = useRef<{ section: NavItemId; startedAt: number } | null>(null);
  const { filters, applyFilters, resetFilters, options, getOptionsFor } = useFleetFilters();
  const data = useDashboardData(filters, refreshKey);
  const showGlobalFilters = !["users", "notifications", "admin-notifications", "diesel"].includes(activeSection);
  const allowedItems = useMemo(
    () => NAV_ITEMS.filter((item) => canAccessNav(currentUser, item.id)),
    [currentUser],
  );

  useEffect(() => {
    if (!allowedItems.some((item) => item.id === activeSection)) {
      const fallback = allowedItems[0]?.id ?? "management";
      setActiveSection(fallback);
      writeSectionToUrl(fallback, "replace");
      return;
    }

    if (sectionFromUrl() !== activeSection) {
      writeSectionToUrl(activeSection, "replace");
    }
  }, [activeSection, allowedItems]);

  useEffect(() => {
    const handlePopState = () => {
      const requestedSection = sectionFromUrl();
      const fallback = allowedItems[0]?.id ?? "management";
      const nextSection = requestedSection && allowedItems.some((item) => item.id === requestedSection)
        ? requestedSection
        : fallback;

      if (nextSection !== activeSection) {
        sectionTimerRef.current = { section: nextSection, startedAt: performance.now() };
        setTimingNotice(null);
        setActiveSection(nextSection);
      }
      if (requestedSection !== nextSection) {
        writeSectionToUrl(nextSection, "replace");
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [activeSection, allowedItems]);

  useEffect(() => {
    const item = NAV_ITEMS.find((candidate) => candidate.id === activeSection);
    document.title = item ? `${item.label} | Mining Operations` : "Mining Operations";
  }, [activeSection]);

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
    if (section !== activeSection) {
      sectionTimerRef.current = { section, startedAt: performance.now() };
      setTimingNotice(null);
      writeSectionToUrl(section, "push");
      setActiveSection(section);
    }
  };

  return (
    <div className="min-h-screen bg-coal-50">
      <Sidebar active={activeSection} onChange={handleSectionChange} items={allowedItems} />
      <main className="lg:pl-72">
        <TopBar user={currentUser} onLogout={onLogout} onOpenNotifications={() => handleSectionChange("notifications")} />
        {showGlobalFilters && (
          <GlobalFilters
            filters={filters}
            options={options}
            getOptionsFor={getOptionsFor}
            applyFilters={applyFilters}
            resetFilters={resetFilters}
            onRefresh={() => setRefreshKey((current) => current + 1)}
          />
        )}
        <div className="px-4 py-4 pb-24 lg:px-6 lg:pb-4">
          {data.error ? (
            <Panel title="Unable to load dashboard">
              <p className="text-sm text-red-700">{data.error}</p>
            </Panel>
          ) : (
            <Suspense fallback={<LoadingState />}>
              {renderSection(activeSection, data, filters, showTimingNotice)}
            </Suspense>
          )}
        </div>
      </main>
      <MobileNav active={activeSection} onChange={handleSectionChange} items={allowedItems} />
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
  return sectionFromUrl() ?? "management";
}

function sectionFromUrl(): NavItemId | null {
  const section = new URLSearchParams(window.location.search).get("section");
  return NAV_ITEMS.some((item) => item.id === section) ? section as NavItemId : null;
}

function writeSectionToUrl(section: NavItemId, mode: "push" | "replace") {
  const url = new URL(window.location.href);
  url.searchParams.set("section", section);
  const state = { ...window.history.state, section };
  if (mode === "push") {
    window.history.pushState(state, "", url);
  } else {
    window.history.replaceState(state, "", url);
  }
}

function renderSection(
  activeSection: NavItemId,
  data: ReturnType<typeof useDashboardData>,
  filters: ReturnType<typeof useFleetFilters>["filters"],
  onTimingComplete: (message: string, elapsedMs: number) => void,
) {
  switch (activeSection) {
    case "management":
      return <ManagementDashboard overview={data.overview} loading={data.loading} />;
    case "fleet":
      return <FleetDashboard rows={data.fleetRows} alerts={data.alerts} loading={data.loading} />;
    case "fuel":
      return <FuelDashboard summary={data.fuelSummary} loading={data.loading} />;
    case "diesel":
      return <DieselDashboard />;
    case "production":
      return <ProductionDashboard summary={data.productionSummary} loading={data.loading} />;
    case "alerts":
      return <AlertsDashboard alerts={data.alerts} fleetRows={data.fleetRows} loading={data.loading} />;
    case "reports":
      return (
        <ReportsDashboard
          reports={data.reports}
          filters={filters}
          loading={data.loading}
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
    case "users":
      return <UserManagementDashboard />;
    case "settings":
      return <SettingsDashboard />;
    default:
      return <ManagementDashboard overview={data.overview} loading={data.loading} />;
  }
}
