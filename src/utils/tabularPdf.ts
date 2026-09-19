import type { ReportPreview } from "../types/reports";

export interface TabularPdfContext {
  company?: string;
  shift?: string;
  siteId?: string;
  dateFrom?: string;
  dateTo?: string;
  timeFrom?: string;
  timeTo?: string;
}

const ascii = (value: string) => value.replace(/[â€“â€”]/g, "-").replace(/[^\x20-\x7E]/g, " ");
const escape = (value: string) => ascii(value).replace(/([\\()])/g, "\\$1");
const cell = (value: unknown) => value === null || value === undefined || value === "" ? "--"
  : typeof value === "number" ? value.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : String(value);
const label = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2");
const timestamp = (value?: string) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(value));
};

function wrap(value: string, width: number, size: number): string[] {
  // Conservative Helvetica bounds also account for wide capital serial numbers.
  const limit = Math.max(1, Math.floor((width - 12) / (size * 0.68)));
  const words = ascii(value).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (let word of words) {
    if (line && line.length + word.length + 1 > limit) { lines.push(line); line = ""; }
    while (word.length > limit) { if (line) { lines.push(line); line = ""; } lines.push(word.slice(0, limit)); word = word.slice(limit); }
    if (word) line += `${line ? " " : ""}${word}`;
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

/** Print all columns and rows, retaining missing values and repeating headings on every page. */
export function buildTabularPdf(preview: ReportPreview, context: TabularPdfContext = {}) {
  const wide = preview.columns.length > 10;
  const width = wide ? 1191 : 842, height = wide ? 842 : 595, margin = 30;
  const fontSize = 9, lineHeight = 12;
  const columns = preview.columns.length ? preview.columns : ["Status"];
  const weights = columns.map(column => /machine|serial|registration|vehicleNumber|last sync/i.test(column) ? 2 : /site|model|driver/i.test(column) ? 1.4 : 1);
  const weight = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map(w => (width - margin * 2) * w / weight);
  const caseLabels: Record<string, string> = { "Total Fuel": "Total fuel (L)", "Average fuel per hour": "Avg fuel (L/h)", Working: "Working (h)", Idle: "Idle (h)", Utilization: "Utilization (%)" };
  const headers = columns.map((column, index) => wrap(preview.oem === "CASE" ? caseLabels[column] || label(column) : label(column), widths[index], fontSize));
  const headerHeight = Math.max(...headers.map(lines => lines.length)) * lineHeight + 14;
  const oem = preview.oem && preview.oem !== "All" ? preview.oem : context.company && context.company !== "All" ? context.company : "All OEMs";
  const site = preview.period?.site || (context.siteId && context.siteId !== "All" ? context.siteId.replace(/^site-(wcl|ncl)-/, "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()).replace(/\bOcm\b/g, "OCM") : "All sites");
  const shift = preview.period?.shift || context.shift || "All";
  const shiftLabel = ["All", "ALL_DAY", "All Shifts"].includes(shift) ? "All Shifts" : shift.startsWith("Shift") ? shift : `Shift ${shift}`;
  const start = preview.period?.start || (context.dateFrom && context.timeFrom ? `${context.dateFrom}T${context.timeFrom}:00+05:30` : undefined);
  const end = preview.period?.end || (context.dateTo && context.timeTo ? `${context.dateTo}T${context.timeTo}:00+05:30` : undefined);
  const meta = [
    `OEM: ${oem} | Site: ${site} | ${shiftLabel} | Rows: ${preview.rows.length}`,
    `Period (IST): ${start || end ? `${timestamp(start)} to ${timestamp(end)}` : "Not recorded in source report"}`,
    `Generated (IST): ${timestamp(preview.generatedAt)}`,
  ];
  const notice = preview.error?.message || preview.notice || "";
  const noticeLines = notice ? wrap(notice, width - margin * 2, 8) : [];
  const tableTop = 110 + noticeLines.length * 11 + (noticeLines.length ? 10 : 0);
  const bodyBottom = height - 42;
  const pages: string[][] = [[]];
  let commands = pages[0], y = tableTop + headerHeight;
  const text = (x: number, top: number, value: string, bold = false, size = fontSize, color = "0.08 0.13 0.18") => `BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${(height - top - size).toFixed(2)} Tm (${escape(value)}) Tj ET`;
  const drawCells = (cells: string[][], top: number, rowHeight: number, bold: boolean, fill: string) => {
    let x = margin;
    cells.forEach((lines, index) => {
      commands.push(`${fill} rg 0.68 0.74 0.79 RG 0.4 w ${x.toFixed(2)} ${(height - top - rowHeight).toFixed(2)} ${widths[index].toFixed(2)} ${rowHeight.toFixed(2)} re B`);
      lines.forEach((line, lineIndex) => commands.push(text(x + 6, top + 7 + lineIndex * lineHeight, line, bold, fontSize, fill === "0.10 0.25 0.36" ? "1 1 1" : undefined)));
      x += widths[index];
    });
  };
  const pageHeader = () => {
    commands.push(text(margin, 23, preview.reportType, true, 17));
    meta.forEach((line, index) => commands.push(text(margin, 50 + index * 17, line, index === 0, 9)));
    noticeLines.forEach((line, index) => commands.push(text(margin, 107 + index * 11, line, false, 8)));
    drawCells(headers, tableTop, headerHeight, true, "0.10 0.25 0.36");
  };
  pageHeader();
  const rows = [...(preview.summary ? [preview.summary] : []), ...preview.rows];
  if (!rows.length) commands.push(text(margin + 8, y + 12, "No data available for the selected period."));
  rows.forEach((row, index) => {
    const cells = columns.map((column, i) => wrap(cell(row[column]), widths[i], fontSize));
    // Very long text values continue on the next page instead of clipping or dropping data.
    let offset = 0;
    const totalLines = Math.max(...cells.map(lines => lines.length));
    while (offset < totalLines) {
      let capacity = Math.floor((bodyBottom - y - 14) / lineHeight);
      if (capacity < 1) { commands = []; pages.push(commands); pageHeader(); y = tableTop + headerHeight; capacity = Math.floor((bodyBottom - y - 14) / lineHeight); }
      const count = Math.max(1, Math.min(totalLines - offset, capacity));
      const rowHeight = count * lineHeight + 14;
      drawCells(cells.map(lines => lines.slice(offset, offset + count)), y, rowHeight, Boolean(preview.summary && index === 0), index % 2 ? "0.94 0.97 0.98" : "1 1 1");
      y += rowHeight; offset += count;
    }
  });
  pages.forEach((page, index) => page.push(text(margin, height - 25, `CMLL FMS | ${oem} | Page ${index + 1} of ${pages.length}`, false, 8)));
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];
  pages.forEach((page, i) => {
    const stream = page.join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
