import { Search } from "lucide-react";

interface ReportSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export function ReportSearch({ value, onChange }: ReportSearchProps) {
  return (
    <label className="relative block min-w-0 flex-1">
      <span className="sr-only">Search reports by name</span>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-coal-400" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search reports by name"
        className="h-10 w-full rounded-md border border-coal-200 bg-white pl-9 pr-3 text-sm text-coal-900 outline-none transition placeholder:text-coal-400 focus:border-ore-500 focus:ring-2 focus:ring-ore-500/20"
      />
    </label>
  );
}
