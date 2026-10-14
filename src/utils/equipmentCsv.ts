import type { EquipmentRecord } from "../services/equipmentMasterService";
export const equipmentColumns = [
  ["equipment", "Equipment / Door no"], ["serialNumber", "Serial number / VIN"],
  ["category", "Category"], ["model", "Model"], ["oem", "OEM"],
  ["location", "Location"], ["roadStatus", "Road status"], ["driver", "Driver"],
] as const;
export function equipmentCsv(rows: EquipmentRecord[]) {
  const cell = (value: string) => `"${(/^[=+@\-\t\r]/.test(value) ? "'" + value : value).replace(/"/g, '""')}"`;
  return "\uFEFF" + [equipmentColumns.map(([, label]) => cell(label)).join(","),
    ...rows.map(row => equipmentColumns.map(([key]) => cell(row[key] || "")).join(","))].join("\r\n");
}
export function parseEquipmentCsv(text: string): EquipmentRecord[] {
  const records: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n")) {
      row.push(field.replace(/\r$/, "")); field = "";
      if (char === "\n") { records.push(row); row = []; }
    } else field += char;
  }
  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  if (field || row.length) { row.push(field.replace(/\r$/, "")); records.push(row); }
  const headers = (records.shift() || []).map(value => value.trim().toLowerCase());
  const positions = equipmentColumns.map(([key, label]) => {
    const index = headers.indexOf(label.toLowerCase()); return index >= 0 ? index : headers.indexOf(key.toLowerCase());
  });
  if (positions[0] < 0 || positions[1] < 0) throw new Error("Use the CSV template: Equipment / Door no and Serial number / VIN are required.");
  const rows = records.filter(values => values.some(value => value.trim())).map((values, i) => {
    const record = Object.fromEntries(equipmentColumns.map(([key], column) => [key, (values[positions[column]] || "").trim()])) as unknown as EquipmentRecord;
    if (!record.equipment || !record.serialNumber) throw new Error(`Row ${i + 2}: equipment and serial number are required.`);
    record.id = ""; record.roadStatus ||= "Unknown";
    return record;
  });
  if (!rows.length || rows.length > 2000) throw new Error("Import between 1 and 2,000 records at a time.");
  return rows;
}
