import assert from "node:assert/strict";
import test from "node:test";
import type { ReportPreview } from "../src/types/reports.ts";
import { buildDriverwiseStandstillPdf } from "../src/utils/driverwisePdf.ts";

function volvoPreview(): ReportPreview {
  return {
    reportType: "Driverwise Standstill Tracking",
    generatedAt: "2026-08-18T11:24:00.000Z",
    oem: "Volvo",
    columns: [
      "Vehicles",
      "Drivers",
      "Total time (hh:mm)",
      "Driving (km)",
      "Diesel engine on (l)",
      "Avg diesel engine on (km/l)",
      "Standstill (%)",
      "Standstill (hh:mm)",
      "Engine load % time of Total time (%)",
      "Coasting (%)",
      "Avg diesel (l/h)",
    ],
    rows: [
      {
        Vehicles: "V-500",
        Drivers: "Driver One",
        "Total time (hh:mm)": "1:30",
        "Driving (km)": 10,
        "Diesel engine on (l)": 50,
        "Avg diesel engine on (km/l)": 0.5,
        "Standstill (%)": 20,
        "Standstill (hh:mm)": "0:30",
        "Engine load % time of Total time (%)": 30,
        "Coasting (%)": 10,
        "Avg diesel (l/h)": 20,
      },
      {
        Vehicles: "V-501",
        Drivers: "Driver Two",
        "Total time (hh:mm)": "2:15",
        "Driving (km)": 30,
        "Diesel engine on (l)": 70,
        "Avg diesel engine on (km/l)": 0.7,
        "Standstill (%)": 40,
        "Standstill (hh:mm)": "1:00",
        "Engine load % time of Total time (%)": 20,
        "Coasting (%)": 30,
        "Avg diesel (l/h)": 10,
      },
    ],
    period: {
      date: "2026-08-18",
      shift: "A",
      site: "Sasti",
      start: "2026-08-18T05:00:00+05:30",
      end: "2026-08-18T13:00:00+05:30",
      timezone: "Asia/Kolkata",
    },
  };
}

function extractTextCommands(pdf: Uint8Array) {
  const source = new TextDecoder().decode(pdf);
  return [...source.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)]
    .map((match) => match[1].replace(/\\([\\()])/g, "$1"));
}

test("adds the on-screen Volvo summary row to the PDF", () => {
  const text = extractTextCommands(buildDriverwiseStandstillPdf(volvoPreview()));
  const summaryIndex = text.indexOf("Summary (2)");

  assert.notEqual(summaryIndex, -1);
  assert.deepEqual(text.slice(summaryIndex, summaryIndex + 11), [
    "Summary (2)",
    "2 vehicles",
    "3:45",
    "40.00",
    "120.00",
    "0.60",
    "30.00",
    "1:30",
    "25.00",
    "20.00",
    "15.00",
  ]);
});

test("keeps the summary row off Scania PDFs", () => {
  const preview = volvoPreview();
  preview.oem = "Scania";
  preview.columns = ["Registration number", ...preview.columns];

  const text = extractTextCommands(buildDriverwiseStandstillPdf(preview));

  assert.equal(text.some((value) => value.startsWith("Summary (")), false);
});

test("uses the frozen official summary and extended Volvo metrics in the PDF", () => {
  const preview = volvoPreview();
  preview.columns.splice(8, 0,
    "I-Shift Performance % time of Total time (%)",
    "Above economy % time of Total time (%)",
  );
  preview.summary = {
    Vehicles: "Summary (9)",
    Drivers: "9 vehicles",
    "Total time (hh:mm)": "141:48",
    "Driving (km)": 1262.88,
    "Diesel engine on (l)": 2641.64,
    "Avg diesel engine on (km/l)": 0.48,
    "Standstill (%)": 21.30,
    "Standstill (hh:mm)": "30:12",
    "I-Shift Performance % time of Total time (%)": 0.14,
    "Above economy % time of Total time (%)": 14.22,
    "Engine load % time of Total time (%)": 2.39,
    "Coasting (%)": 4.95,
    "Avg diesel (l/h)": 18.63,
  };

  const text = extractTextCommands(buildDriverwiseStandstillPdf(preview));
  const summaryIndex = text.indexOf("Summary (9)");

  assert.notEqual(summaryIndex, -1);
  assert.deepEqual(text.slice(summaryIndex, summaryIndex + 13), [
    "Summary (9)",
    "9 vehicles",
    "141:48",
    "1262.88",
    "2641.64",
    "0.48",
    "21.30",
    "30:12",
    "0.14",
    "14.22",
    "2.39",
    "4.95",
    "18.63",
  ]);
});
