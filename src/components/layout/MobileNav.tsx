import type { NavItem, NavItemId } from "../../constants/routes";
import { NAV_ITEMS } from "../../constants/routes";

interface MobileNavProps {
  active: NavItemId;
  onChange: (id: NavItemId) => void;
  items?: readonly NavItem[];
}

export function MobileNav({ active, onChange, items = NAV_ITEMS }: MobileNavProps) {
  return (
    <div className="lg:hidden">
      <label className="sr-only" htmlFor="mobile-nav">Section</label>
      <select
        id="mobile-nav"
        className="h-10 w-full rounded-md border border-coal-200 bg-white px-3 text-sm text-coal-800"
        value={active}
        onChange={(event) => onChange(event.target.value as NavItemId)}
      >
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );
}
