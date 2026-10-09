import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let html = await readFile(resolve(root, "dist/index.html"), "utf8");
const script = html.match(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/);
const style = html.match(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/);
if (!script || !style)
  throw new Error("Build must contain one JS bundle and one CSS file.");
const js = await readFile(resolve(root, "dist", script[1]), "utf8");
const css = await readFile(resolve(root, "dist", style[1]), "utf8");
html = html
  .replace(
    script[0],
    () =>
      `<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>`,
  )
  .replace(
    style[0],
    () => `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`,
  );
html = html.replace(
  "<html",
  "<!-- UI adapted from Dell Technologies SPT frontend, MIT license. See frontend/LICENSE and frontend/UPSTREAM.md. -->\n<html",
);
await writeFile(resolve(root, "../index.html"), html);
console.log("Built standalone index.html for the existing Go server.");
