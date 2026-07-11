import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Database,
  Gauge,
  IndianRupee,
  Search,
  Target,
  Timer,
  Truck,
  X,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
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
  dieselSiteActions,
  type DieselAssetClass,
  type DieselEquipmentRecord,
  type DieselSite,
  type DieselSiteAction,
  type DieselStatus,
} from "../../data/dieselDashboard";
import type { KpiMetric } from "../../types/dashboard";
import { KpiCard } from "../cards/KpiCard";
import { ChartFrame } from "../charts/ChartFrame";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { Panel } from "../ui/Panel";
import { cx } from "../ui/cx";

type SiteFilter = "All Sites" | DieselSite;
type AssetClassFilter = "All classes" | DieselAssetClass;
type StatusFilter = "All statuses" | DieselStatus;
type MetricKey = "consumption-index" | "haulage-intensity" | "haulage-distance" | "loading-rate" | "support-rate" | "power-rate" | "idle-share" | "fuel-cost";

interface DieselMetricDefinition {
  key: MetricKey;
  metric: KpiMetric;
  icon: ReactNode;
  formula: string;
  interpretation: string;
  basis: string;
  rows: DieselEquipmentRecord[];
}

const siteFilters: SiteFilter[] = ["All Sites", "Chandrapur", "Majri", "Sasti"];
const assetClasses: AssetClassFilter[] = ["All classes", "Loading", "Haulage", "Support", "Power"];
const statuses: StatusFilter[] = ["All statuses", "OK", "WATCH", "EXCESS"];
const numberFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const rupeeFormatter = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function DieselDashboard() {
  const [siteFilter, setSiteFilter] = useState<SiteFilter>("All Sites");
  const [assetClassFilter, setAssetClassFilter] = useState<AssetClassFilter>("All classes");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All statuses");
  const [comparisonClass, setComparisonClass] = useState<AssetClassFilter>("All classes");
  const [search, setSearch] = useState("");
  const [selectedEquipment, setSelectedEquipment] = useState<DieselEquipmentRecord | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey | null>(null);
  const [selectedAction, setSelectedAction] = useState<DieselSiteAction | null>(null);

  const siteRows = useMemo(
    () => siteFilter === "All Sites" ? dieselEquipmentRecords : dieselEquipmentRecords.filter((row) => row.site === siteFilter),
    [siteFilter],
  );
  const summary = useMemo(() => summarize(siteRows), [siteRows]);
  const tableRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return siteRows.filter((row) => {
      const matchesClass = assetClassFilter === "All classes" || row.assetClass === assetClassFilter;
      const matchesStatus = statusFilter === "All statuses" || row.status === statusFilter;
      const matchesSearch = !normalizedSearch || [row.id, row.type, row.site, row.operator, row.assetClass]
        .some((value) => value.toLowerCase().includes(normalizedSearch));
      return matchesClass && matchesStatus && matchesSearch;
    });
  }, [assetClassFilter, search, siteRows, statusFilter]);
  const comparisonRows = comparisonClass === "All classes"
    ? siteRows
    : siteRows.filter((row) => row.assetClass === comparisonClass);
  const performanceData = comparisonRows.map((row) => ({
    id: row.id,
    index: consumptionIndex(row),
    class: row.assetClass,
  }));
  const mobileRows = siteRows.filter((row) => row.assetClass !== "Power");
  const idleChartData = mobileRows.map((row) => ({ id: row.id, idle: row.idleFuelPercent }));
  const selectedLosses = siteFilter === "All Sites" ? dieselLossCauses : dieselLossCauses.filter((item) => item.site === siteFilter);
  const selectedActions = siteFilter === "All Sites" ? dieselSiteActions : dieselSiteActions.filter((item) => item.site === siteFilter);
  const totalAvoidableLoss = selectedLosses.reduce((total, item) => total + item.litres, 0);
  const paretoData = useMemo(() => {
    let cumulativeLoss = 0;
    return selectedLosses
      .slice()
      .sort((left, right) => right.litres - left.litres)
      .map((item) => {
        cumulativeLoss += item.litres;
        return {
          cause: item.cause,
          litres: item.litres,
          cumulative: totalAvoidableLoss ? Math.round((cumulativeLoss / totalAvoidableLoss) * 1000) / 10 : 0,
        };
      });
  }, [selectedLosses, totalAvoidableLoss]);
  const annualSpend = summary.totalFuelCost * 12;

  const metrics = useMemo<DieselMetricDefinition[]>(() => [
    {
      key: "consumption-index",
      metric: {
        label: "Consumption Index",
        value: formatOptional(summary.consumptionIndexPercent, 1, "%"),
        subLabel: "Actual ÷ matched OEM baseline × 100; higher is worse",
        tone: consumptionIndexTone(summary.consumptionIndexPercent),
      },
      icon: <Target className="h-5 w-5" />,
      formula: "Σ actual litres ÷ Σ (matched OEM L/hr × engine hours) × 100",
      interpretation: "100 means the sample equals its matched baseline. Values above 100 indicate higher consumption. This is an index, not an efficiency percentage.",
      basis: "All selected units, normalized to each unit's own provisional OEM rate.",
      rows: siteRows,
    },
    {
      key: "haulage-intensity",
      metric: { label: "Haulage Fuel Intensity", value: formatOptional(summary.haulageLitresPerTonne, 3, " L/t"), subLabel: `${formatNumber(summary.haulageTonnes)} hauled tonnes only`, tone: "info" },
      icon: <Truck className="h-5 w-5" />,
      formula: "Dumper fuel litres ÷ dumper hauled-tonnage proxy",
      interpretation: "Lower is generally better only after matching payload, lead, gradient, road condition, and material.",
      basis: "Haulage units only. Excavator loaded-tonnage is deliberately excluded to prevent double counting.",
      rows: summary.haulageRows,
    },
    {
      key: "haulage-distance",
      metric: { label: "Haulage Distance Rate", value: formatOptional(summary.haulageKmPerLitre, 3, " km/L"), subLabel: `${formatNumber(summary.haulageDistanceKm)} km from dumpers`, tone: "neutral" },
      icon: <Gauge className="h-5 w-5" />,
      formula: "Dumper distance kilometres ÷ dumper fuel litres",
      interpretation: "Use with L/t and payload. km/L alone can reward empty or lightly loaded movement.",
      basis: "Haulage units with distance data only.",
      rows: summary.haulageRows.filter((row) => row.distanceKm !== null),
    },
    {
      key: "loading-rate",
      metric: { label: "Loading Fleet Rate", value: formatOptional(summary.loadingLitresPerHour, 2, " L/hr"), subLabel: `${summary.loadingRows.length} excavators; separate loading basis`, tone: "warning" },
      icon: <Activity className="h-5 w-5" />,
      formula: "Excavator fuel litres ÷ excavator engine hours",
      interpretation: "Compare within matched excavator class and duty. Pair with BCM/hr or tonnes/hr when verified production is available.",
      basis: "Loading fleet only; not blended with dumpers, support equipment, or DG sets.",
      rows: summary.loadingRows,
    },
    {
      key: "support-rate",
      metric: { label: "Support HEMM Rate", value: formatOptional(summary.supportLitresPerHour, 2, " L/hr"), subLabel: `${summary.supportRows.length} dozer/grader units`, tone: "neutral" },
      icon: <BarChart3 className="h-5 w-5" />,
      formula: "Support-equipment fuel litres ÷ support-equipment engine hours",
      interpretation: "Replace engine hours with productive hours and measured road/work output when those records become available.",
      basis: "Dozer and grader records only.",
      rows: summary.supportRows,
    },
    {
      key: "power-rate",
      metric: { label: "DG Set Rate (Provisional)", value: formatOptional(summary.powerLitresPerHour, 2, " L/hr"), subLabel: summary.powerRows.length ? "Add kWh and load factor before judging efficiency" : "No DG set in selected site", tone: "neutral" },
      icon: <Zap className="h-5 w-5" />,
      formula: "DG fuel litres ÷ DG running hours",
      interpretation: "L/hr is not a complete DG efficiency measure. L/kWh and load factor are required for a defensible comparison.",
      basis: "Power equipment only; never blended into production L/t.",
      rows: summary.powerRows,
    },
    {
      key: "idle-share",
      metric: { label: "Mobile Idle Fuel Share", value: formatOptional(summary.mobileIdleFuelPercent, 1, "%"), subLabel: "Fuel-weighted; DG set excluded", tone: idleTone(summary.mobileIdleFuelPercent) },
      icon: <Timer className="h-5 w-5" />,
      formula: "Σ (mobile-unit litres × idle-fuel %) ÷ Σ mobile-unit litres",
      interpretation: "Use as a screening signal. Validate queue, delay code, operating mode, and warm-up requirements before action.",
      basis: "Loading, haulage, and support equipment only.",
      rows: mobileRows,
    },
    {
      key: "fuel-cost",
      metric: { label: "Selected Diesel Cost", value: formatRupees(summary.totalFuelCost), subLabel: `${formatNumber(summary.fuelLitres)} L at ${formatRupees(DIESEL_REPORT_META.dieselPricePerLitre)}/L`, tone: "neutral" },
      icon: <IndianRupee className="h-5 w-5" />,
      formula: `Selected fuel litres × ${formatRupees(DIESEL_REPORT_META.dieselPricePerLitre)} per litre`,
      interpretation: "A sample cost view using one portfolio price. Use effective-dated site purchase prices for financial reporting.",
      basis: "All selected units; illustrative monthly snapshot.",
      rows: siteRows,
    },
  ], [mobileRows, siteRows, summary]);

  const selectedMetricDefinition = metrics.find((item) => item.key === selectedMetric) ?? null;

  const columns = useMemo<DataTableColumn<DieselEquipmentRecord>[]>(() => [
    { id: "equipment", header: "Equipment", hideable: false, sortValue: (row) => row.id, render: (row) => <span className="font-semibold text-coal-900">{row.id}</span> },
    { id: "class", header: "Duty class", sortValue: (row) => row.assetClass, render: (row) => <Badge tone={classTone(row.assetClass)}>{row.assetClass}</Badge> },
    { id: "type", header: "Type", sortValue: (row) => row.type, render: (row) => row.type },
    { id: "site", header: "Site", sortValue: (row) => row.site, render: (row) => row.site },
    { id: "duty-kpi", header: "Duty KPI", sortValue: (row) => primaryDutyValue(row), render: (row) => <div><p className="font-semibold text-coal-900">{formatDutyKpi(row)}</p><p className="mt-0.5 text-[11px] text-coal-500">{dutyKpiBasis(row)}</p></div> },
    { id: "consumption-index", header: "Consumption Index", sortValue: consumptionIndex, align: "right", render: (row) => <span className={cx("font-semibold", consumptionIndex(row) > 115 ? "text-red-700" : consumptionIndex(row) > 105 ? "text-amber-700" : "text-emerald-700")}>{consumptionIndex(row).toFixed(1)}%</span> },
    { id: "engine-hours", header: "Engine hrs", sortValue: (row) => row.engineHours, render: (row) => formatNumber(row.engineHours), align: "right" },
    { id: "fuel", header: "Fuel (L)", sortValue: (row) => row.fuelLitres, render: (row) => formatNumber(row.fuelLitres), align: "right" },
    { id: "idle", header: "Idle fuel", sortValue: (row) => row.idleFuelPercent, render: (row) => row.assetClass === "Power" ? "Not assessed" : `${row.idleFuelPercent.toFixed(1)}%`, align: "right" },
    { id: "status", header: "Status", sortValue: (row) => statusRank(row.status), render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge>, align: "center" },
    { id: "operator", header: "Operator", sortValue: (row) => row.operator, initiallyHidden: true, render: (row) => row.operator },
    { id: "fuel-cost", header: "Fuel cost", sortValue: (row) => row.fuelLitres, initiallyHidden: true, render: (row) => formatRupees(row.fuelLitres * DIESEL_REPORT_META.dieselPricePerLitre), align: "right" },
    { id: "source", header: "Source / confidence", sortValue: (row) => row.confidence, initiallyHidden: true, render: (row) => <div><p>{row.source}</p><p className="text-[11px] text-amber-700">{row.confidence} confidence</p></div> },
  ], []);

  const openEquipmentFromMetric = (row: DieselEquipmentRecord) => {
    setSelectedMetric(null);
    setSelectedEquipment(row);
  };
  const openEquipmentFromAction = (row: DieselEquipmentRecord) => {
    setSelectedAction(null);
    setSelectedEquipment(row);
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-lg border border-coal-800 bg-coal-950 text-white shadow-command">
        <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="warning">{DIESEL_REPORT_META.dataStatus}</Badge>
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-ore-500">Duty-correct fuel control</span>
            </div>
            <h1 className="mt-3 text-2xl font-semibold">{DIESEL_REPORT_META.title}</h1>
            <p className="mt-1 text-sm text-coal-300">{DIESEL_REPORT_META.company}</p>
            <p className="mt-2 text-xs text-coal-400">{DIESEL_REPORT_META.reportingPeriod} · Diesel @ {formatRupees(DIESEL_REPORT_META.dieselPricePerLitre)}/L</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField id="diesel-site" label="Site" value={siteFilter} onChange={(value) => setSiteFilter(value as SiteFilter)} options={siteFilters} dark />
            <div className="min-w-48">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-coal-400">Reporting period</span>
              <div className="flex h-10 items-center rounded-md border border-coal-700 bg-coal-900 px-3 text-sm font-medium text-white">
                {DIESEL_REPORT_META.reportingPeriod}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">Demo data — not operationally verified</p>
          <p className="mt-1">{DIESEL_REPORT_META.sourceNote}</p>
        </div>
      </div>

      <Panel title="Data provenance" subtitle="Every decision view should show source, timestamp, freshness, and confidence.">
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SourceFact icon={<Database className="h-4 w-4" />} label="Source" value={DIESEL_REPORT_META.source} detail={DIESEL_REPORT_META.sourceType} />
          <SourceFact icon={<ClipboardCheck className="h-4 w-4" />} label="As of" value={DIESEL_REPORT_META.asOf} detail={DIESEL_REPORT_META.freshness} />
          <SourceFact icon={<AlertTriangle className="h-4 w-4" />} label="Confidence" value="Low" detail={DIESEL_REPORT_META.confidence} tone="warning" />
          <SourceFact icon={<CheckCircle2 className="h-4 w-4" />} label="Isolation" value="Demo totals only" detail="Excluded from the live fleet and management totals." tone="good" />
        </dl>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((definition) => (
          <KpiCard key={definition.key} metric={definition.metric} icon={definition.icon} onClick={() => setSelectedMetric(definition.key)} />
        ))}
      </div>

      <Panel title="Correct measurement basis" subtitle="Production, support, and power equipment are separated so unlike duties are not blended into one misleading KPI.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(["Loading", "Haulage", "Support", "Power"] as DieselAssetClass[]).map((assetClass) => {
            const classRows = siteRows.filter((row) => row.assetClass === assetClass);
            return (
              <button
                key={assetClass}
                type="button"
                onClick={() => setAssetClassFilter(assetClass)}
                className="group rounded-lg border border-coal-200 bg-coal-50 p-4 text-left transition hover:border-ore-500 hover:bg-ore-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ore-500"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-coal-900">{assetClass}</p>
                    <p className="mt-1 text-xs text-coal-500">{assetClassDescription(assetClass)}</p>
                  </div>
                  <Badge tone={classTone(assetClass)}>{classRows.length}</Badge>
                </div>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-ore-700">Filter register <ChevronRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span>
              </button>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Consumption Index vs matched baseline"
          subtitle="100 = matched baseline · amber >105 · red >115. Bars are normalized; higher is worse."
          actions={<SelectField id="comparison-class" label="Duty class" value={comparisonClass} onChange={(value) => setComparisonClass(value as AssetClassFilter)} options={assetClasses} compact />}
        >
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={performanceData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
                <XAxis dataKey="id" />
                <YAxis unit="%" domain={[80, "dataMax + 10"]} />
                <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
                <ReferenceLine y={100} stroke="#1f9d74" strokeDasharray="4 4" label="Baseline" />
                <ReferenceLine y={115} stroke="#d64545" strokeDasharray="5 5" label="Action" />
                <Bar dataKey="index" name="Consumption index" radius={[4, 4, 0, 0]}>
                  {performanceData.map((item) => <Cell key={item.id} fill={item.index > 115 ? "#d64545" : item.index > 105 ? "#e3a008" : "#1f9d74"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <ChartFrame title="Mobile Idle Fuel Share by Unit" subtitle="Power equipment excluded · investigate above 10%; do not treat the threshold as proof of operator fault.">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={idleChartData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
              <XAxis dataKey="id" />
              <YAxis unit="%" />
              <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
              <ReferenceLine y={10} stroke="#d64545" strokeDasharray="5 5" label="Screening line" />
              <Bar dataKey="idle" name="Idle fuel %" radius={[4, 4, 0, 0]}>
                {idleChartData.map((item) => <Cell key={item.id} fill={item.idle > 10 ? "#d64545" : "#1f9d74"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      <Panel title="Equipment Register" subtitle={`${siteFilter} · ${tableRows.length} of ${siteRows.length} units · select any row for full context, trend, formula, and source.`}>
        <div className="mb-4 grid gap-3 rounded-lg border border-coal-200 bg-coal-50 p-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_200px_180px_auto] xl:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-coal-500">Search equipment</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-coal-400" aria-hidden="true" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ID, type, site, operator" className="h-10 w-full rounded-md border border-coal-200 bg-white pl-9 pr-3 text-sm text-coal-900 focus:border-ore-500 focus:outline-none focus:ring-2 focus:ring-ore-500/30" />
            </span>
          </label>
          <SelectField id="asset-class-filter" label="Duty class" value={assetClassFilter} onChange={(value) => setAssetClassFilter(value as AssetClassFilter)} options={assetClasses} />
          <SelectField id="status-filter" label="Status" value={statusFilter} onChange={(value) => setStatusFilter(value as StatusFilter)} options={statuses} />
          <Button type="button" variant="secondary" onClick={() => { setSearch(""); setAssetClassFilter("All classes"); setStatusFilter("All statuses"); }}>Clear filters</Button>
        </div>
        <DataTable
          columns={columns}
          rows={tableRows}
          getRowKey={(row) => row.id}
          getRowLabel={(row) => `Open diesel detail for ${row.id}`}
          onRowClick={setSelectedEquipment}
          maxHeight="max-h-[620px]"
          enableColumnSelector
          defaultSort={{ column: "consumption-index", direction: "desc" }}
          caption={`Diesel equipment register for ${siteFilter}`}
        />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartFrame title={`Major Fuel Losses — ${siteFilter}`} subtitle={`${formatNumber(totalAvoidableLoss)} L estimated opportunity in this illustrative June sample; not realized savings.`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={paretoData} margin={{ top: 10, right: 10, left: 0, bottom: 55 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
              <XAxis dataKey="cause" interval={0} angle={-24} textAnchor="end" height={78} />
              <YAxis yAxisId="litres" />
              <YAxis yAxisId="percent" orientation="right" domain={[0, 100]} unit="%" />
              <Tooltip formatter={(value: number, name: string) => name === "Cumulative %" ? `${value.toFixed(1)}%` : `${formatNumber(value)} L`} />
              <Legend />
              <Bar yAxisId="litres" dataKey="litres" name="Estimated opportunity" fill="#a56414" radius={[4, 4, 0, 0]} />
              <Line yAxisId="percent" type="monotone" dataKey="cumulative" name="Cumulative %" stroke="#d64545" strokeWidth={2} />
              <ReferenceLine yAxisId="percent" y={80} stroke="#d64545" strokeDasharray="5 5" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFrame>

        <Panel title={`Root-cause Register — ${siteFilter}`} subtitle="Filtered with the selected site. Each item still requires source-record validation.">
          <div className="space-y-3">
            {selectedLosses.map((item, index) => (
              <div key={`${item.site}-${item.cause}`} className="flex gap-3 rounded-md border border-coal-100 bg-coal-50 p-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ore-600 text-xs font-semibold text-white">{index + 1}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-coal-900">{item.cause} · {formatNumber(item.litres)} L</p>
                    <Badge>{item.site}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-coal-600">{item.note}</p>
                  <p className="mt-2 text-[11px] text-coal-500">Affected: {item.affectedUnits.join(", ")}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title={`Assigned Fuel Actions — ${siteFilter}`} subtitle="Site-filtered action drill-downs. Expected litres are opportunities until the before/after evidence is verified.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {selectedActions.map((action) => (
            <button key={action.id} type="button" onClick={() => setSelectedAction(action)} className="group rounded-lg border border-coal-200 bg-white p-4 text-left transition hover:border-ore-500 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ore-500">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge tone={priorityTone(action.priority)}>{action.priority}</Badge>
                <Badge tone={action.status === "Verify" ? "info" : action.status === "In progress" ? "warning" : "neutral"}>{action.status}</Badge>
              </div>
              <h3 className="mt-3 text-sm font-semibold text-coal-950">{action.title}</h3>
              <p className="mt-1 text-xs text-coal-500">{action.site} · {action.owner} · due {action.due}</p>
              <div className="mt-3 flex items-end justify-between gap-3 border-t border-coal-100 pt-3">
                <div><p className="text-[11px] uppercase tracking-wide text-coal-500">Expected opportunity</p><p className="mt-1 font-semibold text-ore-700">{formatNumber(action.expectedSavingLitres)} L/month</p></div>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-ore-700">Drill down <ChevronRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span>
              </div>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Portfolio Control Playbook" subtitle="Applies to all sites. This is a control library, not a claim that every action applies to every unit.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {dieselActionGroups.map((group) => (
            <div key={group.title} className="rounded-lg border border-coal-200 bg-coal-50 p-4">
              <h3 className="text-sm font-semibold text-coal-900">{group.title}</h3>
              <ul className="mt-3 space-y-2 text-xs text-coal-700">
                {group.actions.map((action) => <li key={action} className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-ore-600" /><span>{action}</span></li>)}
              </ul>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Portfolio Study Ranges" subtitle="Generic opportunity bands from the supplied study — not site forecasts, commitments, or realized savings.">
          <div className="space-y-5">
            {dieselImprovementTargets.map((target) => (
              <div key={target.label}>
                <div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="font-medium text-coal-800">{target.label}</span><span className="font-semibold tabular-nums text-ore-700">{target.low}–{target.high}%</span></div>
                <div className="h-3 overflow-hidden rounded-full bg-coal-100"><div className="h-full rounded-full bg-gradient-to-r from-ore-500 to-emerald-600" style={{ width: `${(target.high / 40) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Annualized Scenario — Not a Forecast" subtitle="Simple arithmetic on the selected one-month sample; excludes seasonality, production mix, overlap, and implementation cost.">
          <div className="grid gap-4 sm:grid-cols-2">
            <ScenarioCard label="If verified reduction is 10%" value={formatRupees(annualSpend * 0.1)} />
            <ScenarioCard label="If verified reduction is 20%" value={formatRupees(annualSpend * 0.2)} emphasized />
          </div>
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Do not add these scenarios to action-card opportunities. Record realized savings only after a matched baseline and sustained before/after verification.</p>
        </Panel>
      </div>

      <Panel title="Continuous Improvement Cycle" subtitle="Repeat monthly using duty-matched benchmarks and approved source records.">
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-9">
          {dieselImprovementCycle.map((step, index) => <li key={step} className="rounded-lg border border-coal-200 bg-white p-3"><span className="text-xs font-semibold text-ore-700">{String(index + 1).padStart(2, "0")}</span><p className="mt-2 text-sm font-medium text-coal-800">{step}</p></li>)}
        </ol>
      </Panel>

      {selectedEquipment && <EquipmentDetailDrawer row={selectedEquipment} onClose={() => setSelectedEquipment(null)} />}
      {selectedMetricDefinition && <MetricDetailDrawer definition={selectedMetricDefinition} onClose={() => setSelectedMetric(null)} onOpenEquipment={openEquipmentFromMetric} />}
      {selectedAction && <ActionDetailDrawer action={selectedAction} onClose={() => setSelectedAction(null)} onOpenEquipment={openEquipmentFromAction} />}
    </div>
  );
}

function EquipmentDetailDrawer({ row, onClose }: { row: DieselEquipmentRecord; onClose: () => void }) {
  const weeklyProfile = buildDerivedWeeklyProfile(row);
  return (
    <DrawerShell id="diesel-equipment-drawer" eyebrow="Equipment drill-down" title={`${row.id} · ${row.type}`} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2"><Badge tone={classTone(row.assetClass)}>{row.assetClass}</Badge><Badge>{row.site}</Badge><Badge tone={statusTone(row.status)}>{row.status}</Badge><Badge tone="warning">{row.confidence} confidence</Badge></div>
        <Panel title="Duty-correct summary" subtitle={row.measurementContext}>
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricBox label="Consumption index" value={`${consumptionIndex(row).toFixed(1)}%`} detail="Actual ÷ matched baseline; higher is worse" />
            <MetricBox label="Primary duty KPI" value={formatDutyKpi(row)} detail={dutyKpiBasis(row)} />
            <MetricBox label="Actual / baseline" value={`${row.actualLph.toFixed(2)} / ${row.oemLph.toFixed(2)} L/hr`} detail="Provisional matched rate" />
            <MetricBox label="Fuel cost" value={formatRupees(row.fuelLitres * DIESEL_REPORT_META.dieselPricePerLitre)} detail={`${formatNumber(row.fuelLitres)} L sample total`} />
            <MetricBox label="Engine / idle hours" value={`${formatNumber(row.engineHours)} / ${formatNumber(row.idleHours)} hr`} detail={row.assetClass === "Power" ? "DG idle share not assessed" : `${row.idleFuelPercent.toFixed(1)}% estimated idle-fuel share`} />
            <MetricBox label="Operator / custodian" value={row.operator} detail={`As of ${row.asOf}`} />
          </div>
        </Panel>
        <Panel title="Derived Weekly Profile" subtitle="Illustrative shape derived from the monthly sample for interface drill-down only — not raw telemetry.">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weeklyProfile} margin={{ top: 12, right: 16, bottom: 6, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7ebee" />
                <XAxis dataKey="week" />
                <YAxis unit="%" domain={[80, "dataMax + 10"]} />
                <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
                <ReferenceLine y={100} stroke="#1f9d74" strokeDasharray="4 4" label="Baseline" />
                <Line type="monotone" dataKey="index" name="Consumption index" stroke="#a56414" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Context and Formula">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <Detail label="Duty class" value={row.assetClass} />
            <Detail label="Measurement context" value={row.measurementContext} />
            <Detail label="Consumption-index formula" value="Actual L/hr ÷ matched baseline L/hr × 100" />
            <Detail label="Interpretation" value="Above 100 means more fuel than the provisional matched baseline; it does not prove waste or operator fault." />
          </dl>
        </Panel>
        <Panel title="Source, Freshness, and Confidence">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <Detail label="Source" value={row.source} />
            <Detail label="As of" value={row.asOf} />
            <Detail label="Freshness" value={DIESEL_REPORT_META.freshness} />
            <Detail label="Confidence" value={`${row.confidence}: ${DIESEL_REPORT_META.confidence}`} />
          </dl>
        </Panel>
      </div>
    </DrawerShell>
  );
}

function MetricDetailDrawer({ definition, onClose, onOpenEquipment }: { definition: DieselMetricDefinition; onClose: () => void; onOpenEquipment: (row: DieselEquipmentRecord) => void }) {
  return (
    <DrawerShell id="diesel-metric-drawer" eyebrow="KPI drill-down" title={definition.metric.label} onClose={onClose}>
      <div className="space-y-5">
        <div className="rounded-lg border border-ore-200 bg-ore-50 p-5">
          <p className="text-3xl font-semibold text-coal-950">{definition.metric.value}</p>
          <p className="mt-2 text-sm text-coal-600">{definition.metric.subLabel}</p>
        </div>
        <Panel title="Formula and Interpretation">
          <dl className="space-y-4 text-sm"><Detail label="Formula" value={definition.formula} /><Detail label="Included basis" value={definition.basis} /><Detail label="How to read it" value={definition.interpretation} /></dl>
        </Panel>
        <Panel title={`Included Equipment (${definition.rows.length})`} subtitle="Select a unit to continue to the equipment-level drill-down.">
          {definition.rows.length ? (
            <div className="space-y-2">
              {definition.rows.map((row) => (
                <button key={row.id} type="button" onClick={() => onOpenEquipment(row)} className="flex w-full items-center justify-between gap-3 rounded-md border border-coal-200 p-3 text-left hover:border-ore-500 hover:bg-ore-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ore-500">
                  <span><span className="block text-sm font-semibold text-coal-900">{row.id} · {row.type}</span><span className="mt-1 block text-xs text-coal-500">{row.site} · {formatDutyKpi(row)}</span></span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ore-700" />
                </button>
              ))}
            </div>
          ) : <p className="text-sm text-coal-500">No qualifying equipment exists in the selected site.</p>}
        </Panel>
        <Panel title="Data Quality"><p className="text-sm text-amber-900">{DIESEL_REPORT_META.confidence}. Source: {DIESEL_REPORT_META.source}; as of {DIESEL_REPORT_META.asOf}.</p></Panel>
      </div>
    </DrawerShell>
  );
}

function ActionDetailDrawer({ action, onClose, onOpenEquipment }: { action: DieselSiteAction; onClose: () => void; onOpenEquipment: (row: DieselEquipmentRecord) => void }) {
  const affectedRows = dieselEquipmentRecords.filter((row) => action.affectedUnits.includes(row.id));
  return (
    <DrawerShell id="diesel-action-drawer" eyebrow="Action drill-down" title={`${action.id} · ${action.title}`} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2"><Badge tone={priorityTone(action.priority)}>{action.priority}</Badge><Badge>{action.site}</Badge><Badge tone={action.status === "Verify" ? "info" : action.status === "In progress" ? "warning" : "neutral"}>{action.status}</Badge></div>
        <Panel title="Ownership and Value">
          <dl className="grid gap-4 text-sm sm:grid-cols-2"><Detail label="Owner" value={action.owner} /><Detail label="Due" value={action.due} /><Detail label="Expected opportunity" value={`${formatNumber(action.expectedSavingLitres)} L/month`} /><Detail label="Financial equivalent" value={`${formatRupees(action.expectedSavingLitres * DIESEL_REPORT_META.dieselPricePerLitre)}/month (unverified)`} /></dl>
        </Panel>
        <Panel title="Closure Evidence" subtitle="Do not mark this saving as realized until the evidence is accepted."><p className="text-sm text-coal-700">{action.evidence}</p></Panel>
        <Panel title={`Affected Equipment (${affectedRows.length})`}>
          <div className="space-y-2">{affectedRows.map((row) => <button key={row.id} type="button" onClick={() => onOpenEquipment(row)} className="flex w-full items-center justify-between rounded-md border border-coal-200 p-3 text-left hover:border-ore-500 hover:bg-ore-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ore-500"><span className="text-sm font-semibold text-coal-900">{row.id} · {row.type}</span><ChevronRight className="h-4 w-4 text-ore-700" /></button>)}</div>
        </Panel>
        <Panel title="Source Warning"><p className="text-sm text-amber-900">This action comes from the illustrative study sample. Confirm the issue using dispatch, maintenance, road, fuel, and telemetry records before intervention.</p></Panel>
      </div>
    </DrawerShell>
  );
}

function DrawerShell({ id, eyebrow, title, onClose, children }: { id: string; eyebrow: string; title: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-coal-950/55 backdrop-blur-[1px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto bg-white shadow-command">
        <div className="sticky top-0 z-20 flex items-start justify-between gap-4 border-b border-coal-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-ore-700">{eyebrow}</p><h2 id={`${id}-title`} className="mt-1 break-words text-xl font-semibold text-coal-950">{title}</h2></div>
          <Button ref={closeRef} icon={<X className="h-4 w-4" />} variant="ghost" onClick={onClose} aria-label="Close detail drawer" />
        </div>
        <div className="p-5">{children}</div>
      </aside>
    </div>
  );
}

function SelectField({ id, label, value, options, onChange, dark = false, compact = false }: { id: string; label: string; value: string; options: readonly string[]; onChange: (value: string) => void; dark?: boolean; compact?: boolean }) {
  return (
    <label htmlFor={id} className="block">
      <span className={cx("mb-1 block text-xs font-semibold uppercase tracking-wide", dark ? "text-coal-300" : "text-coal-500", compact && "sr-only")}>{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-label={compact ? label : undefined} className={cx("h-10 w-full rounded-md border px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ore-500", dark ? "border-white/20 bg-white/10 text-white" : "border-coal-200 bg-white text-coal-800", compact && "min-w-44")}>
        {options.map((option) => <option key={option} value={option} className="text-coal-900">{option}</option>)}
      </select>
    </label>
  );
}

function SourceFact({ icon, label, value, detail, tone = "neutral" }: { icon: ReactNode; label: string; value: string; detail: string; tone?: "neutral" | "warning" | "good" }) {
  return <div className={cx("rounded-lg border p-4", tone === "warning" ? "border-amber-200 bg-amber-50" : tone === "good" ? "border-emerald-200 bg-emerald-50" : "border-coal-200 bg-coal-50")}><dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-coal-500">{icon}{label}</dt><dd className="mt-2 text-sm font-semibold text-coal-900">{value}</dd><dd className="mt-1 text-xs leading-5 text-coal-600">{detail}</dd></div>;
}

function ScenarioCard({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return <div className={cx("rounded-lg border p-5", emphasized ? "border-emerald-300 bg-emerald-100" : "border-emerald-200 bg-emerald-50")}><p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">{label}</p><p className="mt-3 text-2xl font-semibold text-emerald-950">{value}</p><p className="mt-2 text-xs text-emerald-800">Illustrative arithmetic only</p></div>;
}

function MetricBox({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-md border border-coal-200 bg-coal-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-coal-500">{label}</p><p className="mt-1 text-lg font-semibold text-coal-950">{value}</p><p className="mt-1 text-xs text-coal-500">{detail}</p></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-coal-500">{label}</dt><dd className="mt-1 break-words font-medium text-coal-900">{value}</dd></div>;
}

function summarize(rows: DieselEquipmentRecord[]) {
  const loadingRows = rows.filter((row) => row.assetClass === "Loading");
  const haulageRows = rows.filter((row) => row.assetClass === "Haulage");
  const supportRows = rows.filter((row) => row.assetClass === "Support");
  const powerRows = rows.filter((row) => row.assetClass === "Power");
  const mobileRows = rows.filter((row) => row.assetClass !== "Power");
  const fuelLitres = sum(rows, (row) => row.fuelLitres);
  const expectedFuel = sum(rows, (row) => row.oemLph * row.engineHours);
  const haulageFuel = sum(haulageRows, (row) => row.fuelLitres);
  const haulageTonnes = sum(haulageRows, (row) => row.tonnes ?? 0);
  const haulageDistanceKm = sum(haulageRows, (row) => row.distanceKm ?? 0);
  const mobileFuel = sum(mobileRows, (row) => row.fuelLitres);
  return {
    loadingRows,
    haulageRows,
    supportRows,
    powerRows,
    fuelLitres,
    totalFuelCost: fuelLitres * DIESEL_REPORT_META.dieselPricePerLitre,
    consumptionIndexPercent: divide(fuelLitres, expectedFuel, 100),
    haulageLitresPerTonne: divide(haulageFuel, haulageTonnes),
    haulageKmPerLitre: divide(haulageDistanceKm, haulageFuel),
    haulageTonnes,
    haulageDistanceKm,
    loadingLitresPerHour: ratePerHour(loadingRows),
    supportLitresPerHour: ratePerHour(supportRows),
    powerLitresPerHour: ratePerHour(powerRows),
    mobileIdleFuelPercent: divide(sum(mobileRows, (row) => row.fuelLitres * row.idleFuelPercent), mobileFuel),
  };
}

function ratePerHour(rows: DieselEquipmentRecord[]): number | null {
  return divide(sum(rows, (row) => row.fuelLitres), sum(rows, (row) => row.engineHours));
}

function sum(rows: DieselEquipmentRecord[], select: (row: DieselEquipmentRecord) => number): number {
  return rows.reduce((total, row) => total + select(row), 0);
}

function divide(value: number, divisor: number, multiplier = 1): number | null {
  return divisor > 0 ? (value / divisor) * multiplier : null;
}

function consumptionIndex(row: DieselEquipmentRecord): number {
  return (row.actualLph / row.oemLph) * 100;
}

function primaryDutyValue(row: DieselEquipmentRecord): number {
  if (row.assetClass === "Haulage") return row.litresPerTonne ?? row.actualLph;
  return row.actualLph;
}

function formatDutyKpi(row: DieselEquipmentRecord): string {
  if (row.assetClass === "Haulage") {
    const kmPerLitre = row.distanceKm === null ? null : row.distanceKm / row.fuelLitres;
    return `${row.litresPerTonne?.toFixed(3) ?? "—"} L/t · ${kmPerLitre?.toFixed(3) ?? "—"} km/L`;
  }
  if (row.assetClass === "Loading") return `${row.actualLph.toFixed(2)} L/hr · ${row.litresPerTonne?.toFixed(3) ?? "—"} L/t loaded`;
  if (row.assetClass === "Power") return `${row.actualLph.toFixed(2)} L/hr (provisional)`;
  return `${row.actualLph.toFixed(2)} L/hr`;
}

function dutyKpiBasis(row: DieselEquipmentRecord): string {
  if (row.assetClass === "Haulage") return "Hauled-tonnage and distance basis";
  if (row.assetClass === "Loading") return "Engine-hour + loaded-tonnage proxy";
  if (row.assetClass === "Power") return "Add kWh and load factor";
  return "Replace with productive-hour output when available";
}

function assetClassDescription(assetClass: DieselAssetClass): string {
  if (assetClass === "Loading") return "L/hr plus verified tonnes or BCM loaded";
  if (assetClass === "Haulage") return "L/t, km/L, L/trip, and L/tonne-km";
  if (assetClass === "Support") return "L/productive-hour and work output";
  return "L/kWh and load factor; L/hr is provisional";
}

function buildDerivedWeeklyProfile(row: DieselEquipmentRecord) {
  const multipliers = [0.97, 1.03, 1.05, 0.95];
  return multipliers.map((multiplier, index) => ({ week: `W${index + 1}`, index: consumptionIndex(row) * multiplier }));
}

function formatOptional(value: number | null, digits: number, suffix: string): string {
  return value === null ? "—" : `${value.toFixed(digits)}${suffix}`;
}

function formatNumber(value: number): string {
  return numberFormatter.format(Math.round(value));
}

function formatRupees(value: number): string {
  return rupeeFormatter.format(value);
}

function consumptionIndexTone(value: number | null): KpiMetric["tone"] {
  if (value === null) return "neutral";
  if (value > 115) return "danger";
  if (value > 105) return "warning";
  return "good";
}

function idleTone(value: number | null): KpiMetric["tone"] {
  if (value === null) return "neutral";
  return value > 10 ? "danger" : "good";
}

function statusTone(status: DieselStatus): "good" | "warning" | "danger" {
  if (status === "OK") return "good";
  if (status === "EXCESS") return "danger";
  return "warning";
}

function statusRank(status: DieselStatus): number {
  if (status === "EXCESS") return 3;
  if (status === "WATCH") return 2;
  return 1;
}

function classTone(assetClass: DieselAssetClass): "neutral" | "good" | "warning" | "info" {
  if (assetClass === "Haulage") return "info";
  if (assetClass === "Loading") return "warning";
  if (assetClass === "Power") return "good";
  return "neutral";
}

function priorityTone(priority: DieselSiteAction["priority"]): "danger" | "warning" | "neutral" {
  if (priority === "Critical") return "danger";
  if (priority === "High") return "warning";
  return "neutral";
}
