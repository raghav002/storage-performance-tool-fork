import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
    // The expert flag files live with the Go server (../server/expertflags),
    // outside this folder; the dev server may read them too.
    fs: { allow: [".", "../server/expertflags"] },
  },
  build: {
    target: "es2022",
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
