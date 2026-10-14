import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Filter, Plus, Printer, Search, Upload, X } from "lucide-react";
import { equipmentMasterService, type EquipmentRecord } from "../../services/equipmentMasterService";
import { equipmentColumns, equipmentCsv, parseEquipmentCsv } from "../../utils/equipmentCsv";
import "./equipmentMaster.css";

const emptyRecord: EquipmentRecord = { id: "", equipment: "", serialNumber: "", category: "", model: "", oem: "", location: "", roadStatus: "Unknown" };
const blankFilters = { roadStatus: "", location: "", category: "" };
function download(rows: EquipmentRecord[], name = "equipment-master.csv") {
  const url = URL.createObjectURL(new Blob([equipmentCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function printRows(rows: EquipmentRecord[]) {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Allow pop-ups to print the equipment table.");
  const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
  popup.document.write(`<html><head><title>Equipment Master</title><style>body{font:12px Arial;padding:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:7px;text-align:left}thead{display:table-header-group}@page{size:A4 landscape}</style></head><body><h1>Equipment Master</h1><p>${rows.length} records</p><table><thead><tr>${equipmentColumns.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${equipmentColumns.map(([key]) => `<td>${escape(row[key] || "-")}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`);
  popup.document.close(); popup.focus(); popup.print();
}

export function EquipmentMasterDashboard() {
  const [rows, setRows] = useState<EquipmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(blankFilters);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [record, setRecord] = useState<EquipmentRecord | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<EquipmentRecord[]>([]);
  const [page, setPage] = useState(0);
  useEffect(() => {
    let mounted = true;
    equipmentMasterService.list().then(value => { if (mounted) setRows(value); })
      .catch(error => { if (mounted) setMessage(error.message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);
  const visible = useMemo(() => rows.filter(row => {
    const term = search.toLowerCase();
    return equipmentColumns.some(([key]) => (row[key] || "").toLowerCase().includes(term))
      && Object.entries(filters).every(([key, value]) => !value || row[key as keyof typeof filters] === value);
  }).sort((a, b) => a.equipment.localeCompare(b.equipment, undefined, { numeric: true })), [rows, search, filters]);
  const chosen = visible.filter(row => selected.has(row.id));
  const pageRows = visible.slice(page * 50, page * 50 + 50);
  const allSelected = visible.length > 0 && chosen.length === visible.length;
  useEffect(() => setPage(0), [search, filters, rows]);
  async function save(values: EquipmentRecord[]) {
    setSaving(true); setMessage("");
    try {
      await equipmentMasterService.save(values);
      setRows(await equipmentMasterService.list()); setRecord(null); setImportOpen(false); setImportRows([]);
      setMessage(`${values.length} record${values.length === 1 ? "" : "s"} saved.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save records."); }
    finally { setSaving(false); }
  }
  function print() { try { printRows(chosen.length ? chosen : visible); } catch (error) { setMessage((error as Error).message); } }
  return <section className="equipment-master" aria-label="Equipment Master">
    <header className="em-header"><div><h1>Equipment master</h1><p>All equipment · {visible.length.toLocaleString()} records shown</p></div>
      <div className="em-tools">
        <button onClick={() => { setImportOpen(true); setImportRows([]); }}><Upload size={18} />Import</button>
        <details className="em-export"><summary><Printer size={18} />Print/Export<ChevronDown size={16} /></summary><div>
          <button onClick={print} disabled={!visible.length}>Print / Save PDF{chosen.length ? " (selected)" : ""}</button>
          <button onClick={() => download(chosen.length ? chosen : visible)} disabled={!visible.length}>Export CSV{chosen.length ? " (selected)" : ""}</button>
        </div></details>
        <button className="em-add" onClick={() => setRecord({ ...emptyRecord })}><Plus size={18} />Add record</button>
      </div>
    </header>
    <div className="em-filters">
      <label className="em-search"><Search size={18} /><input aria-label="Search equipment" placeholder="Search equipment, category, serial no...." value={search} onChange={event => setSearch(event.target.value)} /></label>
      <span className="em-count">{visible.length} of {rows.length} records</span>
      <select aria-label="Actions" value="" onChange={event => {
        if (event.target.value === "all") setSelected(new Set(visible.map(row => row.id)));
        if (event.target.value === "clear") setSelected(new Set());
        if (event.target.value === "export") download(chosen);
      }}><option value="">Actions</option><option value="all">Select filtered records</option><option value="clear">Clear selection</option><option value="export" disabled={!chosen.length}>Export selected ({chosen.length})</option></select>
      {([['roadStatus', 'All road statuses'], ['location', 'All locations'], ['category', 'All categories']] as const).map(([key, label]) => <select key={key} aria-label={label} value={filters[key]} onChange={event => setFilters({ ...filters, [key]: event.target.value })}>
        <option value="">{label}</option>{(key === "roadStatus" ? ["On road", "Off road", "Unknown"] : [...new Set(rows.map(row => row[key]).filter(Boolean))].sort()).map(value => <option key={value}>{value}</option>)}
      </select>)}
      <button onClick={() => setFilters({ ...filters })}><Filter size={17} />Filter</button>
    </div>
    {message && <p className="em-message" role="status">{message}</p>}
    {loading ? <p className="em-message" role="status">Loading equipment…</p> : <>
      <div className="em-table"><table><thead><tr><th><input type="checkbox" aria-label="Select all filtered equipment" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map(row => row.id)))} /></th>{equipmentColumns.map(([, label]) => <th key={label}>{label}</th>)}<th>Actions</th></tr></thead><tbody>
        {pageRows.map(row => <tr key={row.id}><td><input type="checkbox" aria-label={`Select ${row.equipment}`} checked={selected.has(row.id)} onChange={() => setSelected(previous => { const next = new Set(previous); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; })} /></td>{equipmentColumns.map(([key]) => <td key={key}>{row[key] || "-"}</td>)}<td><button onClick={() => setRecord({ ...row })}>Edit</button></td></tr>)}
        {!visible.length && <tr><td colSpan={9}>No equipment matches the selected filters.</td></tr>}
      </tbody></table></div>
      <footer className="em-pagination"><span>{chosen.length} selected</span><button disabled={!page} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1} of {Math.max(1, Math.ceil(visible.length / 50))}</span><button disabled={(page + 1) * 50 >= visible.length} onClick={() => setPage(page + 1)}>Next</button></footer>
    </>}
    {(record || importOpen) && <div className="em-overlay" onKeyDown={event => { if (event.key === "Escape" && !saving) { setRecord(null); setImportOpen(false); } }}><div className="em-dialog" role="dialog" aria-modal="true" aria-labelledby="em-dialog-title">
      <div className="em-dialog-heading"><h2 id="em-dialog-title">{record ? record.id ? "Edit equipment" : "Add equipment" : "Import equipment"}</h2><button aria-label="Close dialog" disabled={saving} onClick={() => { setRecord(null); setImportOpen(false); }}><X size={20} /></button></div>
      {record ? <form onSubmit={event => { event.preventDefault(); void save([record]); }}>
        {equipmentColumns.map(([key, label]) => <label key={key}>{label}{key === "roadStatus" ? <select value={record[key]} onChange={event => setRecord({ ...record, [key]: event.target.value })}>{["On road", "Off road", "Unknown"].map(value => <option key={value}>{value}</option>)}</select> : <input autoFocus={key === "equipment"} required={key === "equipment" || key === "serialNumber"} readOnly={key === "serialNumber" && Boolean(record.id)} maxLength={200} value={record[key]} onChange={event => setRecord({ ...record, [key]: event.target.value })} />}</label>)}
        <button className="em-add" disabled={saving}>{saving ? "Saving…" : "Save record"}</button>
      </form> : <div className="em-import"><p>Import a CSV file with equipment, serial number, category, model, OEM, location and road status. Matching serial numbers update existing Equipment Master records.</p>
        <button onClick={() => download([], "equipment-master-template.csv")}>Download CSV template</button>
        <input autoFocus type="file" accept=".csv,text/csv" aria-label="Equipment CSV file" disabled={saving} onChange={async event => { setImportRows([]); const file = event.target.files?.[0]; if (!file) return; try { if (file.size > 2_000_000) throw new Error("Use a CSV smaller than 2 MB."); setImportRows(parseEquipmentCsv(await file.text())); setMessage(""); } catch (error) { setMessage((error as Error).message); } }} />
        <p>{importRows.length} records ready to import</p><button className="em-add" disabled={saving || !importRows.length} onClick={() => void save(importRows)}>{saving ? "Importing…" : "Import records"}</button>
      </div>}
      {message && <p role="status">{message}</p>}
    </div></div>}
  </section>;
}
