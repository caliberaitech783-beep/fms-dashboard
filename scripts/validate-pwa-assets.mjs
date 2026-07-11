import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const manifestPath = join(root, "public", "manifest.webmanifest");
const serviceWorkerPath = join(root, "public", "service-worker.js");
const offlinePath = join(root, "public", "offline.html");

const requiredFiles = [
  manifestPath,
  serviceWorkerPath,
  offlinePath,
  join(root, "public", "icons", "icon-192.png"),
  join(root, "public", "icons", "icon-512.png"),
  join(root, "public", "icons", "maskable-512.png"),
];

const missing = requiredFiles.filter((file) => !existsSync(file));
if (missing.length) {
  throw new Error(`Missing PWA files: ${missing.join(", ")}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const requiredManifestFields = ["id", "name", "short_name", "description", "start_url", "scope", "display", "theme_color", "background_color", "icons"];
const missingFields = requiredManifestFields.filter((field) => !manifest[field]);
if (missingFields.length) {
  throw new Error(`Missing manifest fields: ${missingFields.join(", ")}`);
}

if (manifest.display !== "standalone") {
  throw new Error("Manifest display must be standalone.");
}

const has192 = manifest.icons.some((icon) => icon.sizes === "192x192" && icon.type === "image/png");
const has512 = manifest.icons.some((icon) => icon.sizes === "512x512" && icon.type === "image/png" && icon.purpose === "any");
const hasMaskable = manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable");
if (!has192 || !has512 || !hasMaskable) {
  throw new Error("Manifest must include 192, 512, and maskable icons.");
}

const serviceWorker = readFileSync(serviceWorkerPath, "utf8");
if (!serviceWorker.includes("notificationclick") || !serviceWorker.includes("push")) {
  throw new Error("Service worker must handle push and notificationclick events.");
}

console.log("PWA assets validated.");
