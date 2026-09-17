import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import { compareInventory, parseInventoryWorkbook } from "../scripts/inventory-importer.mjs";

async function makeWorkbook(rows) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "inventory-importer-"));
  const filePath = path.join(directory, "estoque.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Planilha");
  sheet.addRow(["Cód. Empresa", "Empresa", "Cód. Produto", "Produto", "Grupo", "Fabricante", "Lote", "Validade", "Custo Médio", "Estoque"]);
  for (const row of rows) sheet.addRow(row);
  await workbook.xlsx.writeFile(filePath);
  return { directory, filePath };
}

test("converte a planilha da AgroConfiança para o inventário do site", async (t) => {
  const fixture = await makeWorkbook([
    [1, "CONFIAN-GO", "0002254", "AGRISYNC D - 12,5 L", "FERTILIZANTES", "AGRICHEM DO BRASIL SA", "1908-16693", new Date(Date.UTC(2027, 8, 4)), 29957, 362.5],
  ]);
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const parsed = await parseInventoryWorkbook(fixture.filePath);
  assert.deepEqual(parsed.items[0], {
    companyCode: 1,
    company: "CONFIAN-GO",
    productCode: "0002254",
    product: "AGRISYNC D - 12,5 L",
    group: "FERTILIZANTES",
    supplier: "AGRICHEM DO BRASIL SA",
    lot: "1908-16693",
    expiry: "2027-09-04",
    totalCost: 29957,
    stock: 362.5,
  });
});

test("identifica itens mantidos, alterados, novos e removidos", () => {
  const base = { companyCode: 1, company: "CONFIAN-GO", productCode: "0000001", product: "A", group: "G", supplier: "F", lot: "L1", expiry: "2027-01-01", totalCost: 10, stock: 1 };
  const removed = { ...base, productCode: "0000002", lot: "L2" };
  const added = { ...base, productCode: "0000003", lot: "L3" };
  const changed = { ...base, totalCost: 12 };
  const result = compareInventory([base, removed], [changed, added]);
  assert.equal(result.changed.length, 1);
  assert.equal(result.added.length, 1);
  assert.equal(result.removed.length, 1);
  assert.equal(result.unchanged.length, 0);
});
