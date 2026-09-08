import { useEffect, useMemo, useRef, useState } from "react";
import { Grid3X3, X } from "lucide-react";
import type { NavItem, NavItemId } from "../../constants/routes";
import { NAV_GROUPS, NAV_ITEMS } from "../../constants/routes";
import { cx } from "../ui/cx";

interface MobileNavProps {
  active: NavItemId;
  onChange: (id: NavItemId) => void;
  items?: readonly NavItem[];
}

const PRIMARY_MOBILE_IDS: readonly NavItemId[] = ["management", "reports", "fleet", "notifications"];

export function MobileNav({ active, onChange, items = NAV_ITEMS }: MobileNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const primaryItems = useMemo(() => {
    const preferred = PRIMARY_MOBILE_IDS
      .map((id) => items.find((item) => item.id === id))
      .filter((item): item is NavItem => Boolean(item));
    const remaining = items.filter((item) => !preferred.some((preferredItem) => preferredItem.id === item.id));

    return [...preferred, ...remaining].slice(0, 4);
  }, [items]);
  const activeIsPrimary = primaryItems.some((item) => item.id === active);

  useEffect(() => {
    if (!moreOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [moreOpen]);

  const selectSection = (id: NavItemId) => {
    onChange(id);
    setMoreOpen(false);
  };

  return (
    <>
      <nav
        aria-label="Primary mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-coal-200 bg-white/95 px-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1 shadow-[0_-12px_30px_-24px_rgba(9,16,22,0.65)] backdrop-blur lg:hidden"
      >
        <div
          className="mx-auto grid max-w-xl gap-0.5"
          style={{ gridTemplateColumns: `repeat(${primaryItems.length + 1}, minmax(0, 1fr))` }}
        >
          {primaryItems.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectSection(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={cx(
                  "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-[10px] font-semibold transition",
                  isActive ? "bg-ore-600 text-white" : "text-coal-600 hover:bg-coal-50 hover:text-coal-950",
                )}
              >
                <Icon aria-hidden="true" className="h-5 w-5" />
                <span className="w-full truncate">{mobileLabel(item)}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            className={cx(
              "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-[10px] font-semibold transition",
              !activeIsPrimary || moreOpen
                ? "bg-ore-600 text-white"
                : "text-coal-600 hover:bg-coal-50 hover:text-coal-950",
            )}
          >
            <Grid3X3 aria-hidden="true" className="h-5 w-5" />
            <span>More</span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-coal-950/55"
            aria-label="Close section menu"
            onClick={() => setMoreOpen(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-section-menu-title"
            className="absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-y-auto rounded-t-2xl bg-white pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-command"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-coal-200 bg-white px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ore-700">Navigate</p>
                <h2 id="mobile-section-menu-title" className="text-lg font-semibold text-coal-950">All portal sections</h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close section menu"
                className="flex h-11 w-11 items-center justify-center rounded-full border border-coal-200 text-coal-700 hover:bg-coal-50"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-5 p-4">
              {NAV_GROUPS.map((group) => {
                const groupItems = items.filter((item) => item.group === group.id);
                if (groupItems.length === 0) {
                  return null;
                }

                return (
                  <section key={group.id} aria-labelledby={`mobile-nav-group-${group.id}`}>
                    <h3
                      id={`mobile-nav-group-${group.id}`}
                      className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-coal-500"
                    >
                      {group.label}
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      {groupItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = item.id === active;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => selectSection(item.id)}
                            aria-current={isActive ? "page" : undefined}
                            className={cx(
                              "flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm font-medium",
                              isActive
                                ? "border-ore-600 bg-ore-600 text-white"
                                : "border-coal-200 bg-white text-coal-800 hover:border-coal-300 hover:bg-coal-50",
                            )}
                          >
                            <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                            <span>{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function mobileLabel(item: NavItem): string {
  if (item.id === "management") return "Home";
  return item.label.replace(" Control", "");
}
