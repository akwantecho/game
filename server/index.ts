import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachHub } from "./hub";

const PORT = Number(process.env.PORT) || 8787;
const DIST = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

// In production the same port serves the built client; in dev Vite serves it and proxies /ws here.
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/healthz") return void res.end("ok");
  if (!existsSync(DIST)) {
    res.writeHead(404).end("Client not built. Run `npm run build`, or use `npm run dev`.");
    return;
  }
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  const ext = extname(file);
  res.writeHead(200, {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    "cache-control": file.includes(`${DIST}/assets/`) ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(file).pipe(res);
});

attachHub(server);
server.listen(PORT, () => console.log(`Letters War server on http://localhost:${PORT}`));
