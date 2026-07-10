import { useEffect, useMemo, useState } from "react";
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
import { AlertsDashboard } from "../components/dashboard/AlertsDashboard";
import { AdminNotificationsDashboard } from "../components/dashboard/AdminNotificationsDashboard";
import { FleetDashboard } from "../components/dashboard/FleetDashboard";
import { FuelDashboard } from "../components/dashboard/FuelDashboard";
import { IntegrationsDashboard } from "../components/dashboard/IntegrationsDashboard";
import { ManagementDashboard } from "../components/dashboard/ManagementDashboard";
import { MasterDataDashboard } from "../components/dashboard/MasterDataDashboard";
import { NotificationCenterDashboard } from "../components/dashboard/NotificationCenterDashboard";
import { ProductionDashboard } from "../components/dashboard/ProductionDashboard";
import { ReportsDashboard } from "../components/dashboard/ReportsDashboard";
import { SettingsDashboard } from "../components/dashboard/SettingsDashboard";
import { UserManagementDashboard } from "../components/dashboard/UserManagementDashboard";
import { WhatsAppDeliveryDashboard } from "../components/dashboard/WhatsAppDeliveryDashboard";
import { LoadingState } from "../components/ui/LoadingState";
import { Panel } from "../components/ui/Panel";

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
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
  const [activeSection, setActiveSection] = useState<NavItemId>(() => initialSectionFromUrl());
  const [refreshKey, setRefreshKey] = useState(0);
  const { filters, setFilter, resetFilters, options } = useFleetFilters();
  const data = useDashboardData(filters, refreshKey);
  const showGlobalFilters = !["users", "notifications", "admin-notifications"].includes(activeSection);
  const allowedItems = useMemo(
    () => NAV_ITEMS.filter((item) => canAccessNav(currentUser, item.id)),
    [currentUser],
  );

  useEffect(() => {
    if (!allowedItems.some((item) => item.id === activeSection)) {
      setActiveSection(allowedItems[0]?.id ?? "management");
    }
  }, [activeSection, allowedItems]);

  if (!currentUser) {
    return null;
  }

  return (
    <div className="min-h-screen bg-coal-50">
      <Sidebar active={activeSection} onChange={setActiveSection} items={allowedItems} />
      <main className="lg:pl-72">
        <TopBar user={currentUser} onLogout={onLogout} onOpenNotifications={() => setActiveSection("notifications")} />
        {showGlobalFilters && (
          <GlobalFilters
            filters={filters}
            options={options}
            setFilter={setFilter}
            resetFilters={resetFilters}
            onRefresh={() => setRefreshKey((current) => current + 1)}
          />
        )}
        <div className="px-4 py-4 lg:px-6">
          <div className="mb-4">
            <MobileNav active={activeSection} onChange={setActiveSection} items={allowedItems} />
          </div>
          {data.error ? (
            <Panel title="Unable to load dashboard">
              <p className="text-sm text-red-700">{data.error}</p>
            </Panel>
          ) : (
            renderSection(activeSection, data, filters)
          )}
        </div>
      </main>
    </div>
  );
}

function initialSectionFromUrl(): NavItemId {
  const section = new URLSearchParams(window.location.search).get("section");
  return NAV_ITEMS.some((item) => item.id === section) ? section as NavItemId : "management";
}

function renderSection(
  activeSection: NavItemId,
  data: ReturnType<typeof useDashboardData>,
  filters: ReturnType<typeof useFleetFilters>["filters"],
) {
  switch (activeSection) {
    case "management":
      return <ManagementDashboard overview={data.overview} loading={data.loading} />;
    case "fleet":
      return <FleetDashboard rows={data.fleetRows} alerts={data.alerts} loading={data.loading} />;
    case "fuel":
      return <FuelDashboard summary={data.fuelSummary} loading={data.loading} />;
    case "production":
      return <ProductionDashboard summary={data.productionSummary} loading={data.loading} />;
    case "alerts":
      return <AlertsDashboard alerts={data.alerts} fleetRows={data.fleetRows} loading={data.loading} />;
    case "reports":
      return <ReportsDashboard reports={data.reports} filters={filters} loading={data.loading} />;
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
