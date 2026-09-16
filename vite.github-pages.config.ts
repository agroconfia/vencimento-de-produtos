import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./github-pages", import.meta.url));
const publicDir = fileURLToPath(new URL("./public", import.meta.url));
const outDir = fileURLToPath(new URL("./dist-pages", import.meta.url));

export default defineConfig({
  root,
  publicDir,
  base: "/vencimento-de-produtos/",
  plugins: [react()],
  build: {
    outDir,
    emptyOutDir: true,
  },
});
