import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Fuel,
  Gauge,
  IndianRupee,
  Target,
  Timer,
  TrendingDown,
  Truck,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DIESEL_REPORT_META,
  dieselActionGroups,
  dieselEquipmentRecords,
  dieselImprovementCycle,
  dieselImprovementTargets,
  dieselLossCauses,
  type DieselEquipmentRecord,
  type DieselSite,
} from "../../data/dieselDashboard";
import { KpiCard } from "../cards/KpiCard";
import { ChartFrame } from "../charts/ChartFrame";
import { Badge } from "../ui/Badge";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { Panel } from "../ui/Panel";
import { cx } from "../ui/cx";

type SiteFilter = "All Sites" | DieselSite;

const siteFilters: SiteFilter[] = ["All Sites", "Chandrapur", "Majri", "Sasti"];
const numberFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const rupeeFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function DieselDashboard() {
  const [siteFilter, setSiteFilter] = useState<SiteFilter>("All Sites");
  const rows = useMemo(
    () => siteFilter === "All Sites"
      ? dieselEquipmentRecords
      : dieselEquipmentRecords.filter((row) => row.site === siteFilter),
    [siteFilter],
  );
  const summary = useMemo(() => summarize(rows), [rows]);
  const annualSpend = summary.totalFuelCost * 12;
  const oemChartData = rows.map((row) => ({
    id: row.id,
    actual: row.actualLph,
    oem: row.oemLph,
  }));
  const idleChartData = rows.map((row) => ({ id: row.id, idle: row.idleFuelPercent }));
  let cumulativeLoss = 0;
  const totalAvoidableLoss = dieselLossCauses.reduce((total, item) => total + item.litres, 0);
  const paretoData = dieselLossCauses.map((item) => {
    cumulativeLoss += item.litres;
    return {
      cause: item.cause,
      litres: item.litres,
      cumulative: Math.round((cumulativeLoss / totalAvoidableLoss) * 1000) / 10,
    };
  });

  const columns: DataTableColumn<DieselEquipmentRecord>[] = [
    { header: "Equipment", render: (row) => <span className="font-semibold text-coal-900">{row.id}</span> },
    { header: "Type", render: (row) => row.type },
    { header: "Site", render: (row) => row.site },
    { header: "Engine hrs", render: (row) => formatNumber(row.engineHours), align: "right" },
    { header: "Fuel (L)", render: (row) => formatNumber(row.fuelLitres), align: "right" },
    { header: "Tonnes", render: (row) => nullableNumber(row.tonnes), align: "right" },
    { header: "Distance (km)", render: (row) => nullableNumber(row.distanceKm), align: "right" },
    { header: "Idle hrs", render: (row) => formatNumber(row.idleHours), align: "right" },
    { header: "Actual L/hr", render: (row) => row.actualLph.toFixed(2), align: "right" },
    { header: "OEM L/hr", render: (row) => row.oemLph.toFixed(2), align: "right" },
    { header: "L/tonne", render: (row) => row.litresPerTonne?.toFixed(3) ?? "—", align: "right" },
    { header: "Idle fuel", render: (row) => `${row.idleFuelPercent.toFixed(1)}%`, align: "right" },
    { header: "Fuel cost", render: (row) => formatRupees(row.fuelLitres * DIESEL_REPORT_META.dieselPricePerLitre), align: "right" },
    { header: "Operator", render: (row) => row.operator },
    { header: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge>, align: "center" },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-lg border border-coal-800 bg-coal-950 text-white shadow-command">
        <div className="flex flex-col gap-5 px-5 py-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ore-500">Fuel Consumption Pattern in Mines</p>
            <h1 className="mt-2 text-2xl font-semibold">{DIESEL_REPORT_META.title}</h1>
            <p className="mt-1 text-sm text-coal-300">{DIESEL_REPORT_META.company}</p>
            <p className="mt-2 text-xs text-coal-400">
              {DIESEL_REPORT_META.reportingPeriod} · Diesel @ {formatRupees(DIESEL_REPORT_META.dieselPricePerLitre)}/L
            </p>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-coal-400">Site filter</p>
            <div className="flex flex-wrap gap-2">
              {siteFilters.map((site) => (
                <button
                  key={site}
                  type="button"
                  onClick={() => setSiteFilter(site)}
                  className={cx(
                    "rounded-md border px-3 py-2 text-sm font-medium transition",
                    siteFilter === site
                      ? "border-ore-500 bg-ore-600 text-white"
                      : "border-white/15 bg-white/5 text-coal-200 hover:bg-white/10",
                  )}
                >
                  {site}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{DIESEL_REPORT_META.sourceNote}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard metric={{ label: "Fuel Efficiency vs OEM", value: `${summary.oemEfficiencyPercent.toFixed(1)}%`, subLabel: "Actual ÷ OEM standard × 100", tone: summary.oemEfficiencyPercent > 115 ? "danger" : summary.oemEfficiencyPercent > 105 ? "warning" : "good" }} icon={<Target className="h-5 w-5" />} />
        <KpiCard metric={{ label: "Fuel Consumption", value: `${summary.litresPerHour.toFixed(2)} L/hr`, subLabel: `${formatNumber(summary.engineHours)} engine hours`, tone: "warning" }} icon={<Gauge className="h-5 w-5" />} />
        <KpiCard metric={{ label: "Fuel per Tonne", value: `${summary.litresPerTonne.toFixed(3)} L/t`, subLabel: `${formatNumber(summary.tonnes)} tonnes produced`, tone: "info" }} icon={<Truck className="h-5 w-5" />} />
        <KpiCard metric={{ label: "Tonnes per Litre", value: `${summary.tonnesPerLitre.toFixed(2)} t/L`, subLabel: "Production ÷ fuel consumed", tone: "good" }} icon={<TrendingDown className="h-5 w-5" />} />
        <KpiCard metric={{ label: "Fuel Cost per Tonne", value: formatRupees(summary.costPerTonne), subLabel: "Fuel cost ÷ tonnes produced", tone: "neutral" }} icon={<IndianRupee className="h-5 w-5" />} />
        <KpiCard metric={{ label: "Idle Fuel", value: `${summary.idleFuelPercent.toFixed(1)}%`, subLabel: "Weighted share · target below 10%", tone: summary.idleFuelPercent > 10 ? "danger" : "good" }} icon={<Timer className="h-5 w-5" />} />
        <KpiCard metric={{ label: "Total Diesel Consumed", value: `${formatNumber(summary.fuelLitres)} L`, subLabel: `${rows.length} filtered units`, tone: "info" }} icon={<Fuel className="h-5 w-5" />} />
        <KpiCard metric={{ label: "Total Fuel Cost", value: formatRupees(summary.totalFuelCost), subLabel: `@ ${formatRupees(DIESEL_REPORT_META.dieselPricePerLitre)}/L`, tone: "neutral" }} icon={<IndianRupee className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartFrame title="Actual vs OEM Standard (L/hr)" subtitle="Green ≤ OEM+5% · Amber ≤ OEM+15% · Red > OEM+15%">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={oemChartData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
              <XAxis dataKey="id" />
              <YAxis />
              <Tooltip formatter={(value: number) => `${value.toFixed(2)} L/hr`} />
              <Legend />
              <Bar dataKey="actual" name="Actual" fill="#a56414" radius={[4, 4, 0, 0]} />
              <Bar dataKey="oem" name="OEM standard" fill="#7890a0" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame title="Idle Fuel % by Unit" subtitle="Units above the 10% line need dispatch or operator action">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={idleChartData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
              <XAxis dataKey="id" />
              <YAxis unit="%" />
              <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
              <ReferenceLine y={10} stroke="#d64545" strokeDasharray="5 5" label="10% target" />
              <Bar dataKey="idle" name="Idle fuel %" radius={[4, 4, 0, 0]}>
                {idleChartData.map((item) => (
                  <Cell key={item.id} fill={item.idle > 10 ? "#d64545" : "#1f9d74"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      <Panel
        title="Baseline Register & Equipment-wise Analysis vs OEM"
        subtitle={`${siteFilter} · ${rows.length} units · June 2026`}
      >
        <DataTable columns={columns} rows={rows} getRowKey={(row) => row.id} maxHeight="max-h-[620px]" />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartFrame title="Major Fuel Losses — Pareto" subtitle={`${formatNumber(totalAvoidableLoss)} L estimated avoidable loss in the June audit`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={paretoData} margin={{ top: 10, right: 10, left: 0, bottom: 55 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
              <XAxis dataKey="cause" interval={0} angle={-24} textAnchor="end" height={78} />
              <YAxis yAxisId="litres" />
              <YAxis yAxisId="percent" orientation="right" domain={[0, 100]} unit="%" />
              <Tooltip formatter={(value: number, name: string) => name === "Cumulative %" ? `${value.toFixed(1)}%` : `${formatNumber(value)} L`} />
              <Legend />
              <Bar yAxisId="litres" dataKey="litres" name="Avoidable loss" fill="#a56414" radius={[4, 4, 0, 0]} />
              <Line yAxisId="percent" type="monotone" dataKey="cumulative" name="Cumulative %" stroke="#d64545" strokeWidth={2} />
              <ReferenceLine yAxisId="percent" y={80} stroke="#d64545" strokeDasharray="5 5" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFrame>

        <Panel title="Loss Register — Root Cause Notes" subtitle="From shift logs, telematics and workshop records">
          <div className="space-y-3">
            {dieselLossCauses.map((item, index) => (
              <div key={item.cause} className="flex gap-3 rounded-md border border-coal-100 bg-coal-50 p-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ore-600 text-xs font-semibold text-white">{index + 1}</span>
                <div>
                  <p className="text-sm font-semibold text-coal-900">{item.cause} · {formatNumber(item.litres)} L</p>
                  <p className="mt-1 text-xs text-coal-600">{item.note}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Optimization Techniques — Action Board" subtitle="Assign an owner and review progress in the monthly fuel meeting">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {dieselActionGroups.map((group) => (
            <div key={group.title} className="rounded-lg border border-coal-200 bg-coal-50 p-4">
              <h3 className="text-sm font-semibold text-coal-900">{group.title}</h3>
              <ul className="mt-3 space-y-2 text-xs text-coal-700">
                {group.actions.map((action) => (
                  <li key={action} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-ore-600" />
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Target Improvements — Achievable Savings" subtitle="Range shown is the typical achievable band from the supplied study">
          <div className="space-y-5">
            {dieselImprovementTargets.map((target) => (
              <div key={target.label}>
                <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-coal-800">{target.label}</span>
                  <span className="font-semibold tabular-nums text-ore-700">{target.low}–{target.high}%</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-coal-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-ore-500 to-emerald-600" style={{ width: `${(target.high / 40) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Overall Fuel Cost Reduction Potential" subtitle="Current filtered run-rate annualized over 12 months">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">At 10% saving / year</p>
              <p className="mt-3 text-2xl font-semibold text-emerald-900">{formatRupees(annualSpend * 0.1)}</p>
            </div>
            <div className="rounded-lg border border-emerald-300 bg-emerald-100 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">At 20% saving / year</p>
              <p className="mt-3 text-2xl font-semibold text-emerald-950">{formatRupees(annualSpend * 0.2)}</p>
            </div>
          </div>
          <blockquote className="mt-4 rounded-lg border-l-4 border-ore-600 bg-coal-50 p-4 text-sm italic text-coal-700">
            What gets measured, gets managed. Fuel saved today is profit earned today—and sustainability secured for tomorrow.
          </blockquote>
        </Panel>
      </div>

      <Panel title="Continuous Improvement Cycle" subtitle="Repeat monthly and benchmark against the best-performing equipment">
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-9">
          {dieselImprovementCycle.map((step, index) => (
            <li key={step} className="rounded-lg border border-coal-200 bg-white p-3">
              <span className="text-xs font-semibold text-ore-700">{String(index + 1).padStart(2, "0")}</span>
              <p className="mt-2 text-sm font-medium text-coal-800">{step}</p>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}

function summarize(rows: DieselEquipmentRecord[]) {
  const engineHours = rows.reduce((total, row) => total + row.engineHours, 0);
  const fuelLitres = rows.reduce((total, row) => total + row.fuelLitres, 0);
  const tonnes = rows.reduce((total, row) => total + (row.tonnes ?? 0), 0);
  const oemFuel = rows.reduce((total, row) => total + (row.oemLph * row.engineHours), 0);
  const idleFuelWeighted = rows.reduce((total, row) => total + (row.fuelLitres * row.idleFuelPercent), 0);
  const totalFuelCost = fuelLitres * DIESEL_REPORT_META.dieselPricePerLitre;

  return {
    engineHours,
    fuelLitres,
    tonnes,
    totalFuelCost,
    litresPerHour: safeDivide(fuelLitres, engineHours),
    litresPerTonne: safeDivide(fuelLitres, tonnes),
    tonnesPerLitre: safeDivide(tonnes, fuelLitres),
    costPerTonne: safeDivide(totalFuelCost, tonnes),
    oemEfficiencyPercent: safeDivide(fuelLitres, oemFuel) * 100,
    idleFuelPercent: safeDivide(idleFuelWeighted, fuelLitres),
  };
}

function safeDivide(value: number, divisor: number): number {
  return divisor > 0 ? value / divisor : 0;
}

function formatNumber(value: number): string {
  return numberFormatter.format(Math.round(value));
}

function nullableNumber(value: number | null): string {
  return value === null ? "—" : formatNumber(value);
}

function formatRupees(value: number): string {
  return rupeeFormatter.format(value);
}

function statusTone(status: DieselEquipmentRecord["status"]): "good" | "warning" | "danger" {
  if (status === "OK") return "good";
  if (status === "EXCESS") return "danger";
  return "warning";
}
