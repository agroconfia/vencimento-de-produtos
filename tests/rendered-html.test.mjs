import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the inventory application", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Vencimento de Produtos<\/title>/i);
  assert.match(html, /Controle de Vencimento de Estoque/);
  assert.match(html, /Fornecedores/);
  assert.match(html, /Produtos/);
  assert.match(html, /AGRICHEM DO BRASIL SA/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("builds a GitHub Pages version with subpath-safe assets", async () => {
  const [html, manifest, serviceWorker, page, workflow] = await Promise.all([
    readFile(new URL("../dist-pages/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist-pages/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../dist-pages/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8"),
  ]);

  assert.match(html, /\/vencimento-de-produtos\/assets\//);
  assert.match(html, /\/vencimento-de-produtos\/manifest\.webmanifest/);
  assert.match(manifest, /"start_url": "\.\/"/);
  assert.match(manifest, /"scope": "\.\/"/);
  assert.match(serviceWorker, /self\.registration\.scope/);
  assert.match(page, /publicPath\("sw\.js"\)/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /path: dist-pages/);
});
