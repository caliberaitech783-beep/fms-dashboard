import { useMemo, useState } from "react";
import type { FleetVehicleRow } from "../../services/fleetService";
import { SHIFT_DEFINITIONS } from "../../constants/shifts";
import { formatDate, formatEfficiency, formatNumber } from "../../utils/formatters";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { LoadingState } from "../ui/LoadingState";
import { Panel } from "../ui/Panel";
import { cx } from "../ui/cx";

interface MasterDataDashboardProps {
  fleetRows: FleetVehicleRow[];
  loading: boolean;
}

const tabs = [
  "Vehicle Master",
  "Company/OEM Master",
  "Model & Capacity Master",
  "Site Master",
  "Types of Work Master",
  "Shift Master",
  "Loading/Unloading Points",
  "Lead Master",
  "Fuel Norm Master",
];

export function MasterDataDashboard({ fleetRows, loading }: MasterDataDashboardProps) {
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const modelRows = useMemo(() => {
    const map = new Map<string, FleetVehicleRow>();
    fleetRows.forEach((row) => map.set(`${row.vehicle.company}-${row.vehicle.modelNumber}`, row));
    return [...map.values()];
  }, [fleetRows]);
  const companyRows = useMemo(() => {
    return [...new Set(fleetRows.map((row) => row.vehicle.company))].map((company) => ({
      company,
      vehicles: fleetRows.filter((row) => row.vehicle.company === company).length,
    }));
  }, [fleetRows]);
  const siteRows = useMemo(() => {
    return [...new Set(fleetRows.map((row) => row.siteName))].map((siteName) => ({
      siteName,
      vehicles: fleetRows.filter((row) => row.siteName === siteName).length,
      contract: fleetRows.find((row) => row.siteName === siteName)?.vehicle.contractType ?? "-",
    }));
  }, [fleetRows]);

  if (loading) {
    return <LoadingState />;
  }

  return (
    <Panel title="Master Data Placeholder" subtitle="Phase 1 provides structure and sample data. CRUD, audit, and validation belong in the next phase.">
      <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cx(
              "shrink-0 rounded-md border px-3 py-2 text-sm font-medium transition",
              activeTab === tab
                ? "border-ore-600 bg-ore-600 text-white"
                : "border-coal-200 bg-white text-coal-700 hover:bg-coal-50",
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Vehicle Master" && (
        <DataTable
          rows={fleetRows.slice(0, 30)}
          getRowKey={(row) => row.vehicle.id}
          columns={[
            { header: "Vehicle", render: (row) => row.vehicle.vehicleNumber },
            { header: "Site", render: (row) => row.siteName },
            { header: "Category", render: (row) => row.vehicle.assetCategory },
            { header: "Type", render: (row) => row.vehicle.assetType },
            { header: "OEM", render: (row) => row.vehicle.company },
            { header: "Model", render: (row) => row.vehicle.modelNumber },
            { header: "Commissioning", render: (row) => formatDate(row.vehicle.commissioningDate) },
          ]}
        />
      )}

      {activeTab === "Company/OEM Master" && (
        <DataTable
          rows={companyRows}
          getRowKey={(row) => row.company}
          columns={[
            { header: "Company/OEM", render: (row) => row.company },
            { header: "Vehicles", render: (row) => formatNumber(row.vehicles), align: "right" },
            { header: "Connector Status", render: () => "Adapter stub ready" },
          ]}
        />
      )}

      {activeTab === "Model & Capacity Master" && (
        <DataTable
          rows={modelRows}
          getRowKey={(row) => `${row.vehicle.company}-${row.vehicle.modelNumber}`}
          columns={[
            { header: "Company", render: (row) => row.vehicle.company },
            { header: "Model", render: (row) => row.vehicle.modelNumber },
            { header: "Category", render: (row) => row.vehicle.assetCategory },
            { header: "Capacity", render: (row) => `${formatNumber(row.vehicle.capacityM3, 1)} m³`, align: "right" },
            { header: "Fuel Norm", render: (row) => formatEfficiency(row.vehicle.standardFuelNorm, row.vehicle.fuelMeasurementUnit), align: "right" },
          ]}
        />
      )}

      {activeTab === "Site Master" && (
        <DataTable
          rows={siteRows}
          getRowKey={(row) => row.siteName}
          columns={[
            { header: "Site", render: (row) => row.siteName },
            { header: "Types of work", render: (row) => row.contract },
            { header: "Vehicles", render: (row) => formatNumber(row.vehicles), align: "right" },
          ]}
        />
      )}

      {activeTab === "Types of Work Master" && (
        <SimpleRows rows={["OCM", "OB"].map((contract) => ({ name: contract, status: "Active" }))} />
      )}
      {activeTab === "Shift Master" && (
        <SimpleRows rows={Object.entries(SHIFT_DEFINITIONS).map(([code, shift]) => ({ name: `Shift ${code}`, status: `${shift.start} to ${shift.end}` }))} />
      )}
      {activeTab === "Loading/Unloading Points" && (
        <SimpleRows rows={["LP-01 East Face", "LP-02 North Bench", "Crusher Hopper 1", "Waste Dump A", "ROM Stockyard"].map((name) => ({ name, status: "Sample point" }))} />
      )}
      {activeTab === "Lead Master" && (
        <SimpleRows rows={[{ name: "Manual entry", status: "Active lead input" }]} />
      )}
      {activeTab === "Fuel Norm Master" && (
        <DataTable
          rows={modelRows}
          getRowKey={(row) => `${row.vehicle.modelNumber}-norm`}
          columns={[
            { header: "Model", render: (row) => row.vehicle.modelNumber },
            { header: "Category", render: (row) => row.vehicle.assetCategory },
            { header: "Norm", render: (row) => formatEfficiency(row.vehicle.standardFuelNorm, row.vehicle.fuelMeasurementUnit), align: "right" },
            { header: "Unit", render: (row) => row.vehicle.fuelMeasurementUnit },
          ]}
        />
      )}
    </Panel>
  );
}

function SimpleRows({ rows }: { rows: Array<{ name: string; status: string }> }) {
  return (
    <DataTable
      rows={rows}
      getRowKey={(row) => row.name}
      columns={[
        { header: "Name", render: (row) => row.name },
        { header: "Status / Detail", render: (row) => row.status },
      ]}
    />
  );
}
