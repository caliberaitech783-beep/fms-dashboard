const fs = require("node:fs");
const path = require("node:path");
const { app } = require("@azure/functions");

const publicRoot = path.resolve(__dirname, "..", "..", "public");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const textExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".svg"]);

function resolvePublicPath(requestPath) {
  const cleanPath = decodeURIComponent(requestPath || "")
    .replace(/^\/+/, "")
    .replace(/\\/g, "/");
  const candidate = path.resolve(publicRoot, cleanPath || "index.html");

  if (!candidate.startsWith(publicRoot)) {
    return path.join(publicRoot, "index.html");
  }

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }

  return path.join(publicRoot, "index.html");
}

function serveFile(request, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const isText = textExtensions.has(extension);
  const body = request.method === "HEAD" ? "" : fs.readFileSync(filePath, isText ? "utf8" : undefined);

  return {
    status: 200,
    body,
    headers: {
      "Content-Type": contentTypes[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=604800",
    },
  };
}

app.http("frontendIndex", {
  route: "app",
  authLevel: "anonymous",
  methods: ["GET", "HEAD"],
  handler: async (request) => serveFile(request, resolvePublicPath("index.html")),
});

app.http("frontendPage", {
  route: "app/{page}",
  authLevel: "anonymous",
  methods: ["GET", "HEAD"],
  handler: async (request) => {
    const page = request.params.page || "";
    if (page.includes(".")) {
      return serveFile(request, resolvePublicPath(page));
    }

    return serveFile(request, resolvePublicPath("index.html"));
  },
});

app.http("frontendAssets", {
  route: "app/assets/{file}",
  authLevel: "anonymous",
  methods: ["GET", "HEAD"],
  handler: async (request) => {
    const file = request.params.file || "";
    return serveFile(request, resolvePublicPath(path.join("assets", file)));
  },
});
