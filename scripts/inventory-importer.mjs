import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const defaultInventoryPath = path.join(repoRoot, "app", "data", "inventory.json");
const defaultMetadataPath = path.join(repoRoot, "app", "data", "inventory-meta.json");

const aliases = {
  companyCode: ["cod empresa", "codigo empresa"],
  company: ["empresa"],
  productCode: ["cod produto", "codigo produto", "codigo", "cod"],
  product: ["produto", "descricao produto", "descricao"],
  group: ["grupo"],
  supplier: ["fabricante", "fornecedor"],
  lot: ["lote"],
  expiry: ["validade", "vencimento", "data validade", "data de validade"],
  totalCost: ["total", "valor estoque", "valor em estoque", "custo total", "valor total"],
  legacyTotalCost: ["custo medio"],
  unitCost: ["custo unitario", "preco medio", "valor unitario"],
  stock: ["estoque", "quantidade", "saldo"],
};

const requiredFields = ["companyCode", "company", "productCode", "product", "group", "supplier", "lot", "expiry", "stock"];

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeHeader(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim();
}

function cellRawValue(cell) {
  const value = cell.value;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if ("result" in value) return value.result;
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return value.text;
  }
  return value;
}

function cellText(cell) {
  const displayed = normalizeText(cell.text);
  if (displayed) return displayed;
  return normalizeText(cellRawValue(cell));
}

function parseBrazilianNumber(value, label, rowNumber) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = normalizeText(value);
  if (!text) throw new Error(`Linha ${rowNumber}: ${label} está vazio.`);
  const cleaned = text.replace(/R\$/gi, "").replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) throw new Error(`Linha ${rowNumber}: ${label} inválido (${text}).`);
  return parsed;
}

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value, rowNumber) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return formatDate(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(value));
    return formatDate(epoch);
  }
  const text = normalizeText(value);
  let match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return text;
  throw new Error(`Linha ${rowNumber}: validade inválida (${text || "vazia"}).`);
}

function productCodeFromCell(cell, rowNumber) {
  const raw = cellRawValue(cell);
  let value = cellText(cell).replace(/\.0+$/, "");
  if (typeof raw === "number" && Number.isInteger(raw)) value = String(raw);
  value = value.replace(/\s/g, "");
  if (!value) throw new Error(`Linha ${rowNumber}: código do produto está vazio.`);
  return /^\d+$/.test(value) && value.length < 7 ? value.padStart(7, "0") : value;
}

function findColumn(headerMap, names) {
  for (const name of names) if (headerMap.has(name)) return headerMap.get(name);
  return undefined;
}

function detectSheetAndColumns(workbook) {
  for (const worksheet of workbook.worksheets) {
    for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 20); rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const headerMap = new Map();
      for (let column = 1; column <= worksheet.columnCount; column += 1) {
        const normalized = normalizeHeader(row.getCell(column).text);
        if (normalized) headerMap.set(normalized, column);
      }
      const columns = {};
      for (const [field, names] of Object.entries(aliases)) columns[field] = findColumn(headerMap, names);
      const hasRequired = requiredFields.every((field) => columns[field]);
      const hasCost = columns.totalCost || columns.legacyTotalCost || columns.unitCost;
      if (hasRequired && hasCost) return { worksheet, rowNumber, columns };
    }
  }
  throw new Error("Não encontrei os cabeçalhos esperados. A planilha precisa ter Empresa, Código do Produto, Produto, Grupo, Fabricante/Fornecedor, Lote, Validade, Estoque e Custo Médio/Total.");
}

function identityKey(item) {
  return [item.companyCode, item.productCode, item.lot, item.expiry].join("|");
}

function isBlankRow(row, columnCount) {
  for (let column = 1; column <= columnCount; column += 1) {
    if (normalizeText(cellRawValue(row.getCell(column)))) return false;
  }
  return true;
}

export async function parseInventoryWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const { worksheet, rowNumber: headerRow, columns } = detectSheetAndColumns(workbook);
  const items = [];
  const seen = new Map();

  for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (isBlankRow(row, worksheet.columnCount)) continue;
    const requiredText = (field, label) => {
      const value = cellText(row.getCell(columns[field]));
      if (!value) throw new Error(`Linha ${rowNumber}: ${label} está vazio.`);
      return value;
    };
    const companyCode = parseBrazilianNumber(cellRawValue(row.getCell(columns.companyCode)), "código da empresa", rowNumber);
    const stock = parseBrazilianNumber(cellRawValue(row.getCell(columns.stock)), "estoque", rowNumber);
    let totalCost;
    if (columns.totalCost) totalCost = parseBrazilianNumber(cellRawValue(row.getCell(columns.totalCost)), "valor total", rowNumber);
    else if (columns.legacyTotalCost) totalCost = parseBrazilianNumber(cellRawValue(row.getCell(columns.legacyTotalCost)), "custo médio", rowNumber);
    else totalCost = parseBrazilianNumber(cellRawValue(row.getCell(columns.unitCost)), "custo unitário", rowNumber) * stock;

    const item = {
      companyCode,
      company: requiredText("company", "empresa"),
      productCode: productCodeFromCell(row.getCell(columns.productCode), rowNumber),
      product: requiredText("product", "produto"),
      group: requiredText("group", "grupo"),
      supplier: requiredText("supplier", "fabricante/fornecedor"),
      lot: requiredText("lot", "lote"),
      expiry: parseDate(cellRawValue(row.getCell(columns.expiry)), rowNumber),
      totalCost: Number(totalCost.toFixed(6)),
      stock: Number(stock.toFixed(6)),
    };
    const key = identityKey(item);
    if (seen.has(key)) throw new Error(`Lote duplicado nas linhas ${seen.get(key)} e ${rowNumber}: ${item.productCode} / ${item.lot} / ${item.expiry}.`);
    seen.set(key, rowNumber);
    items.push(item);
  }
  if (!items.length) throw new Error("A planilha não contém nenhum lote para importar.");
  return { items, sheet: worksheet.name, headerRow, costSource: columns.totalCost ? "total" : columns.legacyTotalCost ? "custo-medio-total" : "custo-unitario" };
}

function itemsEqual(left, right) {
  const fields = ["companyCode", "company", "productCode", "product", "group", "supplier", "lot", "expiry", "totalCost", "stock"];
  return fields.every((field) => typeof left[field] === "number" && typeof right[field] === "number" ? Math.abs(left[field] - right[field]) < 0.000001 : left[field] === right[field]);
}

export function compareInventory(currentItems, newItems) {
  const currentByKey = new Map(currentItems.map((item) => [identityKey(item), item]));
  const newByKey = new Map(newItems.map((item) => [identityKey(item), item]));
  const added = [], changed = [], unchanged = [], removed = [];
  for (const item of newItems) {
    const current = currentByKey.get(identityKey(item));
    if (!current) added.push(item);
    else if (itemsEqual(current, item)) unchanged.push(item);
    else changed.push({ before: current, after: item });
  }
  for (const item of currentItems) if (!newByKey.has(identityKey(item))) removed.push(item);
  return { added, changed, unchanged, removed };
}

async function sha256(filePath) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

function sumInventory(items) {
  return items.reduce((sum, item) => sum + item.totalCost, 0);
}

function currentDateInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function readCurrentMetadata(metadataPath) {
  try {
    return JSON.parse(await fs.readFile(metadataPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { lastUpdated: null };
    throw error;
  }
}

async function createPreview(filePath, inventoryPath, metadataPath) {
  const parsed = await parseInventoryWorkbook(filePath);
  const currentItems = JSON.parse(await fs.readFile(inventoryPath, "utf8"));
  const currentMetadata = await readCurrentMetadata(metadataPath);
  const nextLastUpdated = currentDateInSaoPaulo();
  const difference = compareInventory(currentItems, parsed.items);
  const warnings = [];
  if (parsed.items.length < currentItems.length * 0.5) warnings.push("A nova planilha tem menos da metade dos lotes atuais. Confira se o arquivo selecionado está completo.");
  if (difference.removed.length > 50) warnings.push(`A atualização removerá ${difference.removed.length} lotes. Confira a lista antes de confirmar.`);
  return {
    source: { path: path.resolve(filePath), fileName: path.basename(filePath), sha256: await sha256(filePath), sheet: parsed.sheet, headerRow: parsed.headerRow, costSource: parsed.costSource },
    counts: { current: currentItems.length, next: parsed.items.length, unchanged: difference.unchanged.length, added: difference.added.length, changed: difference.changed.length, removed: difference.removed.length },
    totals: { current: Number(sumInventory(currentItems).toFixed(2)), next: Number(sumInventory(parsed.items).toFixed(2)) },
    lastUpdated: { current: currentMetadata.lastUpdated, next: nextLastUpdated },
    hasChanges: difference.added.length > 0 || difference.changed.length > 0 || difference.removed.length > 0 || currentMetadata.lastUpdated !== nextLastUpdated,
    warnings,
    added: difference.added,
    changed: difference.changed,
    removed: difference.removed,
  };
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const values = { command };
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index], value = rest[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error(`Argumento inválido: ${name ?? "vazio"}.`);
    values[name.slice(2)] = value;
  }
  return values;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (!["preview", "apply"].includes(args.command) || !args.file || !args.output) throw new Error("Uso: node scripts/inventory-importer.mjs <preview|apply> --file planilha.xlsx --output resultado.json");
  const inventoryPath = args.inventory ? path.resolve(args.inventory) : defaultInventoryPath;
  const metadataPath = args.metadata ? path.resolve(args.metadata) : defaultMetadataPath;
  const preview = await createPreview(args.file, inventoryPath, metadataPath);
  if (args.command === "apply") {
    if (!args["expected-sha256"] || args["expected-sha256"] !== preview.source.sha256) throw new Error("A planilha foi alterada depois da prévia. Analise o arquivo novamente antes de publicar.");
    const parsed = await parseInventoryWorkbook(args.file);
    await fs.writeFile(inventoryPath, `${JSON.stringify(parsed.items)}\n`, "utf8");
    await fs.writeFile(metadataPath, `${JSON.stringify({ lastUpdated: preview.lastUpdated.next })}\n`, "utf8");
    preview.applied = true;
  }
  await fs.writeFile(path.resolve(args.output), `${JSON.stringify(preview, null, 2)}\n`, "utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
