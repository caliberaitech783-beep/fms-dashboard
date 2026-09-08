import { useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, Mountain } from "lucide-react";
import type { NavItem, NavItemId } from "../../constants/routes";
import { reportCategories } from "../../config/reportCategories";
import { cx } from "../ui/cx";

interface DesktopNavProps {
  active: NavItemId;
  items: readonly NavItem[];
  onChange: (id: NavItemId) => void;
  onReportChange: (path: string) => void;
}

type MenuId = "reports" | "control" | "admin";

const descriptions: Partial<Record<NavItemId, string>> = {
  notifications: "Your latest updates and notifications",
  "admin-notifications": "Manage announcements across your team",
  whatsapp: "Report schedules and delivery tracking",
  integrations: "Connected OEM services and tracker health",
  "master-data": "Sites, vehicles, and fleet configuration",
  users: "Team members, roles, and access",
  settings: "Portal preferences and configuration",
};

export function DesktopNav({ active, items, onChange, onReportChange }: DesktopNavProps) {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const triggerRefs = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({});
  const panelRef = useRef<HTMLDivElement | null>(null);
  const primaryItems = items.filter((item) => item.group === "operate");
  const groups = (["control", "admin"] as const).filter((group) => items.some((item) => item.group === group));
  const selectedItem = items.find((item) => item.id === active);

  const select = (id: NavItemId) => {
    setOpenMenu(null);
    onChange(id);
  };
  const selectReport = (path: string) => {
    setOpenMenu(null);
    onReportChange(path);
  };

  return (
    <div className="relative z-40 hidden lg:block">
      {openMenu && <div aria-hidden="true" className="fixed inset-0 bg-coal-950/35 backdrop-blur-[2px]" onPointerDown={() => setOpenMenu(null)} />}
      <header
        className="relative border-b border-coal-200 bg-white"
        onMouseLeave={() => setOpenMenu(null)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpenMenu(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && openMenu) {
            triggerRefs.current[openMenu]?.focus();
            setOpenMenu(null);
          }
        }}
      >
        <div className="flex min-h-20 items-center gap-8 px-6 xl:px-8">
          <div className="flex shrink-0 items-center gap-3 text-coal-950">
            <span className="rounded-xl bg-ore-600 p-2.5 text-white"><Mountain className="h-6 w-6" aria-hidden="true" /></span>
            <div><p className="text-base font-bold tracking-tight">CMLL FMS</p><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-coal-500">Mining operations</p></div>
          </div>
          <nav aria-label="Portal sections" className="flex flex-1 items-center gap-1 xl:gap-3">
            {primaryItems.map((item) => item.id === "reports" ? (
              <button
                key={item.id}
                ref={(node) => { triggerRefs.current.reports = node; }}
                type="button"
                aria-expanded={openMenu === "reports"}
                aria-controls="desktop-menu-reports"
                aria-current={active === "reports" ? "page" : undefined}
                onMouseEnter={() => setOpenMenu("reports")}
                onClick={() => setOpenMenu((current) => current === "reports" ? null : "reports")}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setOpenMenu("reports");
                    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
                  }
                }}
                className={cx("flex items-center gap-1.5 rounded-lg px-3 py-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ore-600", active === "reports" || openMenu === "reports" ? "bg-ore-50 text-ore-700" : "text-coal-600 hover:bg-coal-50 hover:text-coal-950")}
              >Reports<ChevronDown className={cx("h-3.5 w-3.5 transition-transform", openMenu === "reports" && "rotate-180")} /></button>
            ) : (
              <button key={item.id} type="button" aria-current={active === item.id ? "page" : undefined} onMouseEnter={() => setOpenMenu(null)} onClick={() => select(item.id)} className={cx("rounded-lg px-3 py-3 text-sm font-semibold transition-colors", active === item.id ? "bg-ore-50 text-ore-700" : "text-coal-600 hover:bg-coal-50 hover:text-coal-950")}>{item.label}</button>
            ))}
            {groups.map((group) => (
              <button
                key={group}
                ref={(node) => { triggerRefs.current[group] = node; }}
                type="button"
                aria-expanded={openMenu === group}
                aria-controls={`desktop-menu-${group}`}
                onMouseEnter={() => setOpenMenu(group)}
                onClick={() => setOpenMenu((current) => current === group ? null : group)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setOpenMenu(group);
                    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
                  }
                }}
                className={cx("flex items-center gap-1.5 rounded-lg px-3 py-3 text-sm font-semibold transition-colors", selectedItem?.group === group || openMenu === group ? "bg-ore-50 text-ore-700" : "text-coal-600 hover:bg-coal-50 hover:text-coal-950")}
              >{group === "control" ? "Control" : "Admin"}<ChevronDown className={cx("h-3.5 w-3.5 transition-transform", openMenu === group && "rotate-180")} /></button>
            ))}
          </nav>
          <span className="hidden text-xs text-coal-500 xl:block">Unified fleet monitoring</span>
        </div>
        {openMenu && (
          <div ref={panelRef} id={`desktop-menu-${openMenu}`} className="absolute inset-x-0 top-full max-h-[calc(100vh-6rem)] overflow-y-auto border-b border-coal-200 bg-white px-8 py-7 shadow-xl motion-safe:animate-[menu-reveal_150ms_ease-out]">
            {openMenu === "reports" ? (
              <>
                <div className="mb-6 flex items-center justify-between border-b border-coal-100 pb-4">
                  <div><p className="text-lg font-semibold text-coal-950">Reports</p><p className="mt-1 text-sm text-coal-500">Explore fleet performance, utilization, and OEM reports.</p></div>
                  <button type="button" onClick={() => selectReport("/reports")} className="flex items-center gap-2 rounded-lg bg-ore-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ore-700">All reports<ArrowUpRight className="h-4 w-4" /></button>
                </div>
                <div className="grid grid-cols-4 gap-x-8 gap-y-6">
                  {reportCategories.map((category) => (
                    <section key={category.id}>
                      <button type="button" onClick={() => selectReport(category.route)} className="mb-2 text-left text-xs font-semibold uppercase tracking-wider text-coal-500 hover:text-ore-700">{category.name}</button>
                      <div className="space-y-0.5">{category.reports.filter((report) => !report.isShortcut).map((report) => (
                        <button key={report.id} type="button" onClick={() => selectReport(report.route)} className="block w-full rounded-md px-2 py-1.5 text-left text-sm font-medium text-coal-800 transition-colors hover:bg-ore-50 hover:text-ore-700">{report.name}</button>
                      ))}</div>
                    </section>
                  ))}
                </div>
              </>
            ) : (
              <div className="grid grid-cols-[1fr_3fr] gap-10">
                <div><p className="text-xs font-semibold uppercase tracking-widest text-ore-600">{openMenu === "control" ? "Stay connected" : "Manage your portal"}</p><h2 className="mt-3 text-2xl font-semibold text-coal-950">{openMenu === "control" ? "Keep operations in sync." : "Everything in one place."}</h2></div>
                <div className="grid grid-cols-2 gap-3">{items.filter((item) => item.group === openMenu).map((item) => {
                  const Icon = item.icon;
                  return <button key={item.id} type="button" aria-current={active === item.id ? "page" : undefined} onClick={() => select(item.id)} className="group flex items-start gap-3 rounded-xl p-4 text-left transition-colors hover:bg-ore-50"><Icon className="mt-0.5 h-5 w-5 shrink-0 text-ore-600" /><span><span className="block text-sm font-semibold text-coal-950 group-hover:text-ore-700">{item.label}</span><span className="mt-1 block text-xs leading-relaxed text-coal-500">{descriptions[item.id]}</span></span></button>;
                })}</div>
              </div>
            )}
          </div>
        )}
      </header>
    </div>
  );
}
