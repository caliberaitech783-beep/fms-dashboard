import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  formatReportGroupValue,
  groupReportRows,
  type ReportRow,
  type ReportRowGroup,
} from "../../utils/reportExplorer";
import { titleCase } from "../../utils/formatters";

interface ReportDrilldownRowsProps {
  rows: ReportRow[];
  drilldownColumn: string;
  subDrilldownColumn: string;
  columnCount: number;
  renderRow: (row: ReportRow, index: number) => ReactNode;
}

export function ReportDrilldownRows({
  rows,
  drilldownColumn,
  subDrilldownColumn,
  columnCount,
  renderRow,
}: ReportDrilldownRowsProps) {
  const groups = useMemo(
    () => groupReportRows(rows, drilldownColumn, subDrilldownColumn),
    [drilldownColumn, rows, subDrilldownColumn],
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setExpandedGroups(new Set());
  }, [drilldownColumn, subDrilldownColumn]);

  if (!drilldownColumn) {
    return <>{rows.map(renderRow)}</>;
  }

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  let rowIndex = 0;
  return (
    <>
      {groups.map((group) => {
        const primaryExpanded = expandedGroups.has(group.key);

        return (
          <Fragment key={group.key}>
            <GroupRow
              group={group}
              label={titleCase(drilldownColumn)}
              expanded={primaryExpanded}
              columnCount={columnCount}
              level={0}
              onToggle={() => toggleGroup(group.key)}
            />
            {primaryExpanded && (subDrilldownColumn
              ? group.subgroups.map((subgroup) => {
                const subgroupExpanded = expandedGroups.has(subgroup.key);
                return (
                  <Fragment key={subgroup.key}>
                    <GroupRow
                      group={subgroup}
                      label={titleCase(subDrilldownColumn)}
                      expanded={subgroupExpanded}
                      columnCount={columnCount}
                      level={1}
                      onToggle={() => toggleGroup(subgroup.key)}
                    />
                    {subgroupExpanded && subgroup.rows.map((row) => renderRow(row, rowIndex++))}
                  </Fragment>
                );
              })
              : group.rows.map((row) => renderRow(row, rowIndex++)))}
          </Fragment>
        );
      })}
    </>
  );
}

interface GroupRowProps {
  group: ReportRowGroup;
  label: string;
  expanded: boolean;
  columnCount: number;
  level: 0 | 1;
  onToggle: () => void;
}

function GroupRow({ group, label, expanded, columnCount, level, onToggle }: GroupRowProps) {
  return (
    <tr className={level === 0 ? "bg-ore-50" : "bg-coal-50"}>
      <td colSpan={columnCount} className="border-b border-coal-200 p-0">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-coal-800 hover:bg-ore-100"
          style={{ paddingLeft: `${12 + level * 24}px` }}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <span>{label}: {formatReportGroupValue(group.value)}</span>
          <span className="ml-1 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-coal-500">
            {group.rows.length} {group.rows.length === 1 ? "row" : "rows"}
          </span>
        </button>
      </td>
    </tr>
  );
}
