import assert from "node:assert/strict";
import test from "node:test";
import { buildTabularPdf } from "../src/utils/tabularPdf.ts";
import type { ReportPreview } from "../src/types/reports.ts";

const preview: ReportPreview = { reportType: "CASE Report", oem: "CASE", generatedAt: "2026-09-19T10:00:00Z", columns: ["Machine", "Total Fuel", "Working"], rows: [{ Machine: "CASE-001", "Total Fuel": 38.87, Working: 0 }] };
const text = (p: ReportPreview) => new TextDecoder().decode(buildTabularPdf(p, { company: "All", siteId: "site-wcl-sasti-ocm", shift: "B", dateFrom: "2026-09-19", dateTo: "2026-09-19", timeFrom: "13:00", timeTo: "15:30" }));

test("structured PDF includes OEM, site, exact timeline, units and zero values", () => {
  const pdf = text(preview);
  assert.match(pdf, /OEM: CASE \| Site: Sasti OCM \| Shift B/);
  assert.match(pdf, /19 Sept 2026, 01:00 pm to 19 Sept 2026, 03:30 pm/);
  assert.ok(pdf.includes("Total fuel \\(L\\)"));
  assert.match(pdf, /\(38.87\) Tj/);
  assert.match(pdf, /\(0\) Tj/);
  assert.match(pdf, / re B/);
});
test("multi-page tables retain every machine and repeat table headings", () => {
  const pdf = text({ ...preview, rows: Array.from({ length: 120 }, (_, i) => ({ Machine: `CASE-${String(i).padStart(3, "0")}`, "Total Fuel": null, Working: i })) });
  const pages = [...pdf.matchAll(/\/Type \/Page /g)].length;
  assert.ok(pages > 1);
  assert.equal([...pdf.matchAll(/\(Machine\) Tj/g)].length, pages);
  for (let i = 0; i < 120; i++) assert.ok(pdf.includes(`(CASE-${String(i).padStart(3, "0")})`));
  assert.ok(pdf.includes(`Page ${pages} of ${pages}`));
});
test("recorded report period takes precedence over subsequently selected filters", () => {
  const pdf = text({ ...preview, period: { date: "2026-09-18", shift: "A", site: "Sasti", start: "2026-09-18T05:00:00+05:30", end: "2026-09-18T10:30:00+05:30", timezone: "Asia/Kolkata" } });
  assert.match(pdf, /18 Sept 2026, 05:00 am to 18 Sept 2026, 10:30 am/);
  assert.match(pdf, /Shift A/);
});
