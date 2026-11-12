import http from "node:http";
import { readFile } from "node:fs/promises";
import { handleRequest } from "../api/lab.js";
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};
const arg = process.argv.indexOf("--port");
const port =
  arg >= 0 ? Number(process.argv[arg + 1]) : Number(process.env.PORT) || 3000;
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/lab") return handleRequest(req, res);
    const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!["index.html", "app.js", "style.css"].includes(name)) {
      res.writeHead(404);
      return res.end("Not found");
    }
    try {
      const bytes = await readFile(
        new URL("../public/" + name, import.meta.url),
      );
      res.writeHead(200, {
        "Content-Type": types[name.slice(name.lastIndexOf("."))],
        "Cache-Control": "no-store",
      });
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(port, "0.0.0.0", () =>
    console.log("Research API Lab ready on port " + port),
  );
