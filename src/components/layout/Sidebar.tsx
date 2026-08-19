import type { NavItem, NavItemId } from "../../constants/routes";
import { NAV_GROUPS, NAV_ITEMS } from "../../constants/routes";
import { cx } from "../ui/cx";

interface SidebarProps {
  active: NavItemId;
  onChange: (id: NavItemId) => void;
  items?: readonly NavItem[];
}

export function Sidebar({ active, onChange, items = NAV_ITEMS }: SidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col bg-gradient-to-b from-[#0b3a5b] via-[#0c4a6e] to-[#082f49] text-white shadow-command lg:flex">
      <div className="border-b border-white/10 px-5 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ore-500">Mining Ops</p>
        <h1 className="mt-2 text-lg font-semibold leading-tight">Unified Mining Fleet Fuel Monitoring Portal</h1>
      </div>
      <nav aria-label="Portal sections" className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.group === group.id);
          if (groupItems.length === 0) {
            return null;
          }

          return (
            <section key={group.id} aria-labelledby={`nav-group-${group.id}`} className="mb-5 last:mb-0">
              <h2
                id={`nav-group-${group.id}`}
                className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-coal-400"
              >
                {group.label}
              </h2>
              <div className="space-y-1">
                {groupItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = active === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onChange(item.id)}
                      aria-current={isActive ? "page" : undefined}
                      className={cx(
                        "flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition",
                        isActive
                          ? "bg-ore-600 text-white shadow-sm"
                          : "text-coal-200 hover:bg-white/10 hover:text-white",
                      )}
                    >
                      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-5 py-4 text-xs text-coal-300">
        Secure mining portal
      </div>
    </aside>
  );
}
