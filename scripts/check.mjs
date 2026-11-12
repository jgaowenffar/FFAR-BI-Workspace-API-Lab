import { readdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
for (const dir of ["api", "server", "scripts", "fixtures", "public"])
  for (const file of await readdir(new URL("../" + dir + "/", import.meta.url)))
    if (/\.(m?js)$/.test(file))
      execFileSync(process.execPath, [
        "--check",
        new URL("../" + dir + "/" + file, import.meta.url).pathname,
      ]);
const html = await readFile(
  new URL("../public/index.html", import.meta.url),
  "utf8",
);
if (!html.includes("app.js") || !html.includes("style.css"))
  throw new Error("Missing entry assets.");
console.log("Syntax and entry assets checked. Ready for Vercel.");
