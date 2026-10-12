import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 4174);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml" };

http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname === "/") { response.writeHead(302, { Location: "/v4/" }); response.end(); return; }
    const relative = pathname.replace(/^\/+/, "");
    const target = path.resolve(ROOT, relative);
    if (!target.startsWith(ROOT + path.sep) && target !== ROOT) { response.writeHead(403); response.end("Forbidden"); return; }
    let file = target;
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html"); }
    catch { response.writeHead(404); response.end("Not found"); return; }
    fs.readFile(file, (error, data) => {
        if (error) { response.writeHead(404); response.end("Not found"); return; }
        response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
        response.end(data);
    });
}).listen(PORT, "127.0.0.1", () => console.log(`Last Letter Finder V4: http://localhost:${PORT}/v4/`));
