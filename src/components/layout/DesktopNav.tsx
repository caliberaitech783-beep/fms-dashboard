import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react";
import type { NavItem, NavItemId } from "../../constants/routes";
import { reportCategories } from "../../config/reportCategories";
import { cx } from "../ui/cx";

interface DesktopNavProps {
  active: NavItemId;
  userControls?: ReactNode;
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

export function DesktopNav({ active, items, onChange, onReportChange, userControls }: DesktopNavProps) {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const triggerRefs = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({});
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const primaryItems = items.filter((item) => item.group === "operate");
  const groups = (["control", "admin"] as const).filter((group) => items.some((item) => item.group === group));
  const selectedItem = items.find((item) => item.id === active);

  useEffect(() => {
    if (!openMenu) return;
    const closeOutside = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const close = () => setOpenMenu(null);
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", close);
    };
  }, [openMenu]);

  const select = (id: NavItemId) => {
    setOpenMenu(null);
    onChange(id);
  };
  const selectReport = (path: string) => {
    setOpenMenu(null);
    onReportChange(path);
  };

  return (
    <div ref={wrapperRef} className="relative z-40 hidden lg:block">
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
        <div className="flex min-h-20 items-center gap-3 px-4 xl:gap-6 xl:px-6">
          <div className="flex shrink-0 items-center gap-3 text-coal-950">
            <img src="/caliber-logo.png" alt="Caliber" className="h-auto w-24 object-contain xl:w-28" />
            <div><p className="text-base font-bold tracking-tight">CMLL FMS</p><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-coal-500">Fuel Monitoring System</p></div>
          </div>
          <nav aria-label="Portal sections" className="flex flex-1 items-center gap-0 xl:gap-1">
            {primaryItems.map((item) => item.id === "reports" ? (
              <button
                key={item.id}
                ref={(node) => { triggerRefs.current.reports = node; }}
                type="button"
                aria-expanded={openMenu === "reports"}
                aria-controls="desktop-menu-reports"
                aria-current={active === "reports" ? "page" : undefined}
                onMouseEnter={() => setOpenMenu("reports")}
                onClick={() => setOpenMenu("reports")}
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
                onClick={() => setOpenMenu(group)}
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
          {userControls}
        </div>
        {openMenu && (
          <div ref={panelRef} id={`desktop-menu-${openMenu}`} style={{ left: Math.max(16, Math.min(triggerRefs.current[openMenu]?.offsetLeft ?? 16, window.innerWidth - (openMenu === "reports" ? 650 : 340))) }} className="absolute top-full w-[19rem] rounded-lg border border-coal-200 bg-white p-2 shadow-xl motion-safe:animate-[menu-reveal_150ms_ease-out]">
            {openMenu === "reports" ? (
              <>
                <button type="button" onClick={() => selectReport("/reports")} className="mb-1 flex w-full items-center justify-between border-b border-coal-100 px-3 py-2 text-xs font-semibold text-ore-700">All reports<ArrowUpRight className="h-3.5 w-3.5" /></button>
                <ReportCategoryMenu onSelect={selectReport} />
              </>
            ) : (
              <div className="max-h-[min(24rem,calc(100dvh-7rem))] overflow-y-auto">{items.filter((item) => item.group === openMenu).map((item) => {
                const Icon = item.icon;
                return <button key={item.id} type="button" aria-current={active === item.id ? "page" : undefined} onClick={() => select(item.id)} title={descriptions[item.id]} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium text-coal-800 hover:bg-ore-50 hover:text-ore-700"><Icon className="h-4 w-4 shrink-0 text-ore-600" />{item.label}</button>;
              })}</div>
            )}
          </div>
        )}
      </header>
    </div>
  );
}

function ReportCategoryMenu({ onSelect }: { onSelect: (path: string) => void }) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  return (
    <div className="relative">
      {reportCategories.map((category) => {
        const expanded = expandedCategory === category.id;
        return (
          <section key={category.id} className="relative" onMouseEnter={() => setExpandedCategory(category.id)}>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={`report-category-${category.id}`}
              onClick={() => setExpandedCategory(category.id)}
              onFocus={() => setExpandedCategory(category.id)}
              className={cx("flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm font-semibold transition-colors hover:bg-ore-50 hover:text-ore-700", expanded ? "bg-ore-50 text-ore-700" : "text-coal-800")}
            >
              {category.name}
              <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
            </button>
            {expanded && (
              <div id={`report-category-${category.id}`} className="absolute left-full top-0 w-[19.5rem] pl-2">
                <div ref={(node) => { if (node) node.style.maxHeight = `${Math.max(80, Math.min(320, window.innerHeight - node.getBoundingClientRect().top - 16))}px`; }} className="overflow-y-auto rounded-lg border border-coal-200 bg-white p-2 shadow-xl">
                {category.reports.filter((report) => !report.isShortcut).map((report) => (
                  <button key={report.id} type="button" onClick={() => onSelect(report.route)} className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-coal-700 transition-colors hover:bg-ore-50 hover:text-ore-700">{report.name}</button>
                ))}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
