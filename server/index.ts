import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi } from "./api";
import { attachHub } from "./hub";
import { Store } from "./store";

const PORT = Number(process.env.PORT) || 8787;
/** Set HOST=127.0.0.1 behind a reverse proxy so the port isn't reachable from outside. */
const HOST = process.env.HOST || undefined;
const DIST = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
/** Accounts and question history. Keep it outside the code checkout so a redeploy can't touch it. */
const DB_PATH = process.env.DB_PATH || resolve(fileURLToPath(new URL("../data/letters-war.db", import.meta.url)));
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

const store = new Store(DB_PATH);

// In production the same port serves the built client; in dev Vite serves it and proxies /ws here.
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/healthz") return void res.end("ok");
  if (url.pathname.startsWith("/api/")) return void handleApi(req, res, store);
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

attachHub(server, { store });
server.listen(PORT, HOST, () => console.log(`Letters War server on http://${HOST ?? "localhost"}:${PORT}`));
