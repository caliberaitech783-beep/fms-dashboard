import type { NavItem, NavItemId } from "../../constants/routes";
import { NAV_ITEMS } from "../../constants/routes";
import { cx } from "../ui/cx";

interface SidebarProps {
  active: NavItemId;
  onChange: (id: NavItemId) => void;
  items?: readonly NavItem[];
}

export function Sidebar({ active, onChange, items = NAV_ITEMS }: SidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col bg-coal-950 text-white shadow-command lg:flex">
      <div className="border-b border-white/10 px-5 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ore-500">Mining Ops</p>
        <h1 className="mt-2 text-lg font-semibold leading-tight">Unified Mining Fleet Fuel Monitoring Portal</h1>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={cx(
                "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition",
                active === item.id
                  ? "bg-ore-600 text-white"
                  : "text-coal-200 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-5 py-4 text-xs text-coal-300">
        Secure mining portal
      </div>
    </aside>
  );
}
