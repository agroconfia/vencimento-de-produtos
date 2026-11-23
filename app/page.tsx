"use client";

import { useEffect, useMemo, useState } from "react";
import inventoryData from "./data/inventory.json";
import inventoryMeta from "./data/inventory-meta.json";
import historyData from "./data/inventory-history.json";

type Item = {
  companyCode: number;
  company: string;
  productCode: string;
  product: string;
  group: string;
  supplier: string;
  lot: string;
  expiry: string;
  totalCost: number;
  stock: number;
};

type RangeFilter = "period" | "expired" | "30" | "60" | "120" | "after120" | "all";
type Tab = "products" | "suppliers" | "analytics";
type SupplierMode = "expired" | "next120";
type ParetoMode = "suppliers" | "products";

type HistoryEntry = {
  date: string;
  totalValue: number;
  lots: number;
  netChange: number;
  outflowValue: number;
  inflowValue: number;
};

const items = inventoryData as Item[];
const inventoryHistory = historyData as HistoryEntry[];
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("pt-BR");
const lastUpdated = date.format(parseDate(inventoryMeta.lastUpdated));
const publicPath = (file: string) => `${import.meta.env.BASE_URL || "/"}${file.replace(/^\/+/, "")}`;

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dayDiff(value: string) {
  const target = parseDate(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function statusFor(days: number) {
  if (days < 0) return { label: "Vencido", tone: "expired" };
  if (days === 0) return { label: "Vence hoje", tone: "critical" };
  if (days <= 30) return { label: `Vence em ${days}d`, tone: "critical" };
  if (days <= 60) return { label: `Vence em ${days}d`, tone: "warning" };
  if (days <= 120) return { label: `Vence em ${days}d`, tone: "attention" };
  return { label: `Vence em ${days}d`, tone: "safe" };
}

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function alphabetical(a: Item, b: Item) {
  return a.product.localeCompare(b.product, "pt-BR", { sensitivity: "base" }) ||
    a.expiry.localeCompare(b.expiry) ||
    a.lot.localeCompare(b.lot, "pt-BR", { numeric: true, sensitivity: "base" });
}

function unitCost(item: Item) {
  return item.stock ? item.totalCost / item.stock : 0;
}

function paretoRows(itemsToGroup: Item[], field: "supplier" | "product") {
  const values = new Map<string, number>();
  itemsToGroup.forEach((item) => values.set(item[field], (values.get(item[field]) ?? 0) + item.totalCost));
  const total = [...values.values()].reduce((sum, value) => sum + value, 0);
  let cumulative = 0;
  return [...values.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }))
    .map((entry, index) => {
      const share = total ? (entry.value / total) * 100 : 0;
      const previous = cumulative;
      cumulative += share;
      const classification = previous < 80 ? "A" : previous < 95 ? "B" : "C";
      return { ...entry, rank: index + 1, share, cumulative, classification };
    });
}

function downloadCsv(rows: Item[]) {
  const headings = ["Código", "Produto", "Grupo", "Fornecedor", "Lote", "Validade", "Dias para vencer", "Estoque", "Custo unitário", "Valor em estoque"];
  const lines = rows.map((item) => [
    item.productCode,
    item.product,
    item.group,
    item.supplier,
    item.lot,
    date.format(parseDate(item.expiry)),
    dayDiff(item.expiry),
    item.stock,
    unitCost(item),
    item.totalCost,
  ]);
  const csv = [headings, ...lines].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `validade-estoque-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("suppliers");
  const [paretoMode, setParetoMode] = useState<ParetoMode>("suppliers");
  const [supplierMode, setSupplierMode] = useState<SupplierMode>("expired");
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);
  const [range, setRange] = useState<RangeFilter>("period");
  const [search, setSearch] = useState("");
  const [supplier, setSupplier] = useState("all");
  const [group, setGroup] = useState("all");
  const [visible, setVisible] = useState(18);
  const [paretoVisible, setParetoVisible] = useState(12);
  const [selected, setSelected] = useState<Item | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [installEvent, setInstallEvent] = useState<Event | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(publicPath("sw.js")).catch(() => undefined);
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);

  const suppliers = useMemo(() => [...new Set(items.map((item) => item.supplier))].sort(), []);
  const groups = useMemo(() => [...new Set(items.map((item) => item.group))].sort(), []);

  const counts = useMemo(() => {
    const expired = items.filter((item) => dayDiff(item.expiry) < 0);
    const d30 = items.filter((item) => dayDiff(item.expiry) >= 0 && dayDiff(item.expiry) <= 30);
    const d120 = items.filter((item) => dayDiff(item.expiry) >= 0 && dayDiff(item.expiry) <= 120);
    const after120 = items.filter((item) => dayDiff(item.expiry) > 120);
    return {
      expired: expired.length,
      expiredValue: expired.reduce((sum, item) => sum + item.totalCost, 0),
      d30: d30.length,
      d30Value: d30.reduce((sum, item) => sum + item.totalCost, 0),
      d120: d120.length,
      d120Value: d120.reduce((sum, item) => sum + item.totalCost, 0),
      after120: after120.length,
      after120Value: after120.reduce((sum, item) => sum + item.totalCost, 0),
    };
  }, []);

  const filtered = useMemo(() => {
    const term = normalized(search.trim());
    return items
      .filter((item) => {
        const days = dayDiff(item.expiry);
        const inRange = range === "all" ||
          (range === "period" && days <= 120) ||
          (range === "expired" && days < 0) ||
          (range === "30" && days >= 0 && days <= 30) ||
          (range === "60" && days >= 0 && days <= 60) ||
          (range === "120" && days >= 0 && days <= 120) ||
          (range === "after120" && days > 120);
        const matchesTerm = !term || normalized(`${item.product} ${item.productCode} ${item.lot} ${item.supplier}`).includes(term);
        return inRange && matchesTerm && (supplier === "all" || item.supplier === supplier) && (group === "all" || item.group === group);
      })
      .sort(alphabetical);
  }, [range, search, supplier, group]);

  const supplierItems = useMemo(() => {
    const term = normalized(search.trim());
    return items
      .filter((item) => {
        const days = dayDiff(item.expiry);
        const matchesStatus = supplierMode === "expired" ? days < 0 : days >= 0 && days <= 120;
        const matchesTerm = !term || normalized(`${item.product} ${item.productCode} ${item.lot} ${item.supplier}`).includes(term);
        return matchesStatus && matchesTerm && (supplier === "all" || item.supplier === supplier) && (group === "all" || item.group === group);
      })
      .sort(alphabetical);
  }, [supplierMode, search, supplier, group]);

  const supplierReport = useMemo(() => {
    const report = new Map<string, { lots: number; value: number; expired: number; next120: number; items: Item[] }>();
    supplierItems.forEach((item) => {
      const current = report.get(item.supplier) ?? { lots: 0, value: 0, expired: 0, next120: 0, items: [] };
      const days = dayDiff(item.expiry);
      current.lots += 1;
      current.value += item.totalCost;
      if (days < 0) current.expired += 1;
      if (days >= 0 && days <= 120) current.next120 += 1;
      current.items.push(item);
      report.set(item.supplier, current);
    });
    return [...report.entries()]
      .map(([name, values]) => ({ name, ...values }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
  }, [supplierItems]);

  const expiredItems = useMemo(() => items.filter((item) => dayDiff(item.expiry) < 0), []);
  const pareto = useMemo(() => ({
    suppliers: paretoRows(expiredItems, "supplier"),
    products: paretoRows(expiredItems, "product"),
  }), [expiredItems]);
  const currentPareto = pareto[paretoMode];
  const totalExpired = useMemo(() => expiredItems.reduce((sum, item) => sum + item.totalCost, 0), [expiredItems]);
  const history = useMemo(() => [...inventoryHistory].sort((a, b) => b.date.localeCompare(a.date)), []);
  const latestMovement = history[0];

  const displayedItems = tab === "products" ? filtered : supplierItems;
  const totalFiltered = displayedItems.reduce((sum, item) => sum + item.totalCost, 0);
  const maxSupplierValue = Math.max(...supplierReport.map((entry) => entry.value), 1);
  const hasExtraFilters = supplier !== "all" || group !== "all";

  function selectRange(value: RangeFilter) {
    setRange(value);
    setVisible(18);
    setTab("products");
  }

  function selectPareto(value: ParetoMode) {
    setParetoMode(value);
    setParetoVisible(12);
  }

  async function installApp() {
    if (installEvent && "prompt" in installEvent) {
      await (installEvent as Event & { prompt: () => Promise<void> }).prompt();
      setInstallEvent(null);
    } else {
      alert("No iPhone, toque em Compartilhar e depois em ‘Adicionar à Tela de Início’. No Android, use o menu do navegador e escolha ‘Instalar aplicativo’. ");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img className="brand-logo" src={publicPath("agroconfianca-branca.png")} alt="AgroConfiança" />
          <div className="brand-divider" aria-hidden="true" />
          <div className="brand-copy">
            <strong>Vencimento de Produtos</strong>
            <span>Controle de estoque · CONFIAN-GO</span>
          </div>
        </div>
        <button className="install-button" onClick={installApp} aria-label="Instalar aplicativo no celular">
          <span aria-hidden="true">↓</span> Instalar
        </button>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">Controle de Vencimento de Estoque</p>
          <h1>Vencimento de Produtos</h1>
          <p>Acompanhe lotes vencidos e a vencer por período.</p>
        </div>
        <div className="updated"><span className="live-dot" /> Última atualização: {lastUpdated}</div>
      </section>

      <section className="summary-grid" aria-label="Resumo de validade">
        <button className={`summary-card red ${range === "expired" ? "active" : ""}`} onClick={() => selectRange("expired")}>
          <span className="summary-icon">!</span>
          <span className="summary-label">Vencidos</span>
          <strong>{counts.expired}</strong>
          <small>{money.format(counts.expiredValue)}</small>
        </button>
        <button className={`summary-card orange ${range === "30" ? "active" : ""}`} onClick={() => selectRange("30")}>
          <span className="summary-icon">30</span>
          <span className="summary-label">Até 30 dias</span>
          <strong>{counts.d30}</strong>
          <small>{money.format(counts.d30Value)}</small>
        </button>
        <button className={`summary-card yellow ${range === "120" ? "active" : ""}`} onClick={() => selectRange("120")}>
          <span className="summary-icon">120</span>
          <span className="summary-label">Até 120 dias</span>
          <strong>{counts.d120}</strong>
          <small>{money.format(counts.d120Value)}</small>
        </button>
        <button className={`summary-card green ${range === "after120" ? "active" : ""}`} onClick={() => selectRange("after120")}>
          <span className="summary-icon">120+</span>
          <span className="summary-label">Após 120 dias</span>
          <strong>{counts.after120}</strong>
          <small>{money.format(counts.after120Value)}</small>
        </button>
      </section>

      <nav className="tabs" aria-label="Seções do aplicativo">
        <button className={tab === "suppliers" ? "active" : ""} onClick={() => setTab("suppliers")}>Fornecedores</button>
        <button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}>Produtos</button>
        <button className={tab === "analytics" ? "active" : ""} onClick={() => setTab("analytics")}>Análises</button>
      </nav>

      {tab !== "analytics" && <section className="controls">
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input value={search} onChange={(event) => { setSearch(event.target.value); setVisible(18); }} placeholder="Buscar produto, código ou lote" />
          {search && <button onClick={() => setSearch("")} aria-label="Limpar busca">×</button>}
        </label>
        <button className={`filter-button ${hasExtraFilters ? "active" : ""}`} onClick={() => setFiltersOpen((value) => !value)}>
          Filtros {hasExtraFilters && <span>•</span>}
        </button>
        <button className="export-button" onClick={() => downloadCsv(displayedItems)}>Exportar CSV</button>
      </section>}

      {tab !== "analytics" && filtersOpen && (
        <section className="filter-panel">
          <label>Fornecedor
            <select value={supplier} onChange={(event) => { setSupplier(event.target.value); setVisible(18); }}>
              <option value="all">Todos os fornecedores</option>
              {suppliers.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label>Grupo
            <select value={group} onChange={(event) => { setGroup(event.target.value); setVisible(18); }}>
              <option value="all">Todos os grupos</option>
              {groups.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          {tab === "products" && <label>Período
            <select value={range} onChange={(event) => selectRange(event.target.value as RangeFilter)}>
              <option value="period">Vencidos + próximos 120 dias</option>
              <option value="expired">Somente vencidos</option>
              <option value="30">Próximos 30 dias</option>
              <option value="60">Próximos 60 dias</option>
              <option value="120">Próximos 120 dias</option>
              <option value="after120">Após 120 dias</option>
              <option value="all">Todo o estoque</option>
            </select>
          </label>}
          {hasExtraFilters && <button className="clear-filters" onClick={() => { setSupplier("all"); setGroup("all"); }}>Limpar filtros</button>}
        </section>
      )}

      {tab === "suppliers" && (
        <section className="supplier-status-switch" aria-label="Situação dos lotes por fornecedor">
          <button
            className={supplierMode === "expired" ? "active expired" : ""}
            onClick={() => { setSupplierMode("expired"); setExpandedSupplier(null); }}
          >
            <span>Vencidos</span><strong>{counts.expired}</strong>
          </button>
          <button
            className={supplierMode === "next120" ? "active next" : ""}
            onClick={() => { setSupplierMode("next120"); setExpandedSupplier(null); }}
          >
            <span>A vencer em até 120 dias</span><strong>{counts.d120}</strong>
          </button>
        </section>
      )}

      {tab !== "analytics" && <section className="result-heading">
        <div>
          <p>{tab === "products" ? "Lotes encontrados" : supplierMode === "expired" ? "Fornecedores com itens vencidos" : "Fornecedores com itens a vencer em até 120 dias"}</p>
          <strong>{tab === "products" ? `${filtered.length} registros` : `${supplierReport.length} fornecedores`}</strong>
        </div>
        <div className="result-value"><span>Total em estoque</span><strong>{money.format(totalFiltered)}</strong></div>
      </section>}

      {tab === "products" ? (
        <section className="product-list compact-list" aria-live="polite">
          {filtered.slice(0, visible).map((item, index) => {
            const status = statusFor(dayDiff(item.expiry));
            return (
              <button className="supplier-product-row inventory-product-row" key={`${item.productCode}-${item.lot}-${index}`} onClick={() => setSelected(item)}>
                <div className="supplier-product-name">
                  <span className={`status ${status.tone}`}>{status.label}</span>
                  <strong>{item.product}</strong>
                  <small>Cód. {item.productCode} · {item.supplier} · Lote {item.lot}</small>
                </div>
                <div><span>Validade</span><strong>{date.format(parseDate(item.expiry))}</strong></div>
                <div><span>Estoque</span><strong>{number.format(item.stock)}</strong></div>
                <div className="unit-cost"><span>Custo</span><strong>{money.format(unitCost(item))}</strong></div>
                <div className="row-value"><span>Total</span><strong>{money.format(item.totalCost)}</strong></div>
              </button>
            );
          })}
          {filtered.length === 0 && <div className="empty-state"><strong>Nenhum lote encontrado</strong><p>Altere a busca ou os filtros para ver outros produtos.</p></div>}
          {visible < filtered.length && <button className="load-more" onClick={() => setVisible((value) => value + 18)}>Mostrar mais {Math.min(18, filtered.length - visible)} lotes</button>}
        </section>
      ) : tab === "suppliers" ? (
        <section className="supplier-list">
          {supplierReport.map((entry, index) => (
            <article className={`supplier-group ${expandedSupplier === entry.name ? "expanded" : ""}`} key={entry.name}>
              <button
                className="supplier-card"
                onClick={() => setExpandedSupplier((current) => current === entry.name ? null : entry.name)}
                aria-expanded={expandedSupplier === entry.name}
              >
                <div className="supplier-rank">{String(index + 1).padStart(2, "0")}</div>
                <div className="supplier-main">
                  <h2>{entry.name}</h2>
                  <div className="bar"><span style={{ width: `${Math.max((entry.value / maxSupplierValue) * 100, 2)}%` }} /></div>
                  <div className="supplier-metrics">
                    <span><strong>{entry.lots}</strong> {entry.lots === 1 ? "lote" : "lotes"}</span>
                    <span>{supplierMode === "expired" ? "Vencidos" : "A vencer até 120d"}</span>
                  </div>
                </div>
                <div className="supplier-value"><span>Total</span><strong>{money.format(entry.value)}</strong></div>
                <span className="expand-icon" aria-hidden="true">{expandedSupplier === entry.name ? "−" : "+"}</span>
              </button>
              {expandedSupplier === entry.name && (
                <div className="supplier-products">
                  <div className="supplier-products-heading">
                    <strong>{entry.lots} {entry.lots === 1 ? "item" : "itens"}</strong>
                    <span>Toque em um produto para ver os detalhes</span>
                  </div>
                  {entry.items.map((item, itemIndex) => {
                    const status = statusFor(dayDiff(item.expiry));
                    return (
                      <button className="supplier-product-row" key={`${item.productCode}-${item.lot}-${itemIndex}`} onClick={() => setSelected(item)}>
                        <div className="supplier-product-name">
                          <span className={`status ${status.tone}`}>{status.label}</span>
                          <strong>{item.product}</strong>
                          <small>Cód. {item.productCode} · Lote {item.lot}</small>
                        </div>
                        <div><span>Validade</span><strong>{date.format(parseDate(item.expiry))}</strong></div>
                        <div><span>Estoque</span><strong>{number.format(item.stock)}</strong></div>
                        <div className="unit-cost"><span>Custo</span><strong>{money.format(unitCost(item))}</strong></div>
                        <div className="row-value"><span>Total</span><strong>{money.format(item.totalCost)}</strong></div>
                      </button>
                    );
                  })}
                </div>
              )}
            </article>
          ))}
          {supplierReport.length === 0 && <div className="empty-state"><strong>Nenhum fornecedor encontrado</strong><p>Altere a busca ou os filtros para ver outros resultados.</p></div>}
        </section>
      ) : (
        <section className="analytics-page">
          <div className="analytics-heading"><div><p className="eyebrow">Análise de estoque</p><h2>Pareto de vencidos e evolução do estoque</h2><p>Priorize os itens e fornecedores que concentram o maior valor já vencido.</p></div></div>
          <div className="analytics-summary">
            <article><span>Valor vencido</span><strong className="outflow">{money.format(totalExpired)}</strong><small>{expiredItems.length} lotes vencidos</small></article>
            <article><span>Última saída registrada</span><strong className="outflow">{money.format(latestMovement?.outflowValue ?? 0)}</strong><small>{latestMovement ? `Atualização de ${date.format(parseDate(latestMovement.date))}` : "Sem atualizações registradas"}</small></article>
            <article><span>Saldo da última atualização</span><strong className={(latestMovement?.netChange ?? 0) >= 0 ? "positive" : "outflow"}>{money.format(latestMovement?.netChange ?? 0)}</strong><small>Entradas menos saídas no período</small></article>
          </div>
          <div className="analytics-section-head"><div><p className="eyebrow">Modelo de Pareto</p><h3>Participação no valor vencido</h3></div><div className="segmented" role="group" aria-label="Tipo da análise Pareto"><button className={paretoMode === "suppliers" ? "active" : ""} onClick={() => selectPareto("suppliers")}>Fornecedores</button><button className={paretoMode === "products" ? "active" : ""} onClick={() => selectPareto("products")}>Produtos</button></div></div>
          <div className="pareto-legend"><span className="pareto-a">A</span> até 80% acumulado <span className="pareto-b">B</span> até 95% <span className="pareto-c">C</span> demais itens</div>
          <div className="pareto-table" role="table" aria-label={`Pareto por ${paretoMode === "suppliers" ? "fornecedores" : "produtos"}`}>
            <div className="pareto-row pareto-header" role="row"><span>#</span><span>{paretoMode === "suppliers" ? "Fornecedor" : "Produto"}</span><span>Valor</span><span>%</span><span>Acumulado</span><span>Classe</span></div>
            {currentPareto.slice(0, paretoVisible).map((entry) => <div className="pareto-row" role="row" key={entry.name}><span>{String(entry.rank).padStart(2, "0")}</span><strong title={entry.name}>{entry.name}</strong><span>{money.format(entry.value)}</span><span>{entry.share.toFixed(1)}%</span><span>{entry.cumulative.toFixed(1)}%</span><span className={`pareto-class pareto-${entry.classification.toLowerCase()}`}>{entry.classification}</span></div>)}
            {paretoVisible < currentPareto.length && <button className="load-more" onClick={() => setParetoVisible((value) => value + 12)}>Mostrar mais {Math.min(12, currentPareto.length - paretoVisible)} {paretoMode === "suppliers" ? "fornecedores" : "produtos"}</button>}
          </div>
          <div className="analytics-section-head history-head"><div><p className="eyebrow">Histórico de atualizações</p><h3>Movimentação entre os períodos</h3></div></div>
          <p className="history-note">Saídas somam reduções de valor e lotes que deixaram de constar na nova planilha. Entradas mostram inclusões e aumentos de valor.</p>
          <div className="history-list">{history.map((entry, index) => <article className="history-row" key={`${entry.date}-${index}`}><div><span>Atualização</span><strong>{date.format(parseDate(entry.date))}</strong><small>{entry.lots} lotes</small></div><div><span>Estoque total</span><strong>{money.format(entry.totalValue)}</strong></div><div><span>Entradas</span><strong className="positive">{money.format(entry.inflowValue)}</strong></div><div><span>Saídas</span><strong className="outflow">{money.format(entry.outflowValue)}</strong></div><div><span>Saldo líquido</span><strong className={entry.netChange >= 0 ? "positive" : "outflow"}>{money.format(entry.netChange)}</strong></div></article>)}</div>
        </section>
      )}

      <footer>
        <img src={publicPath("agroconfianca-colorida.png")} alt="AgroConfiança" />
        <strong>Controle de Vencidos e à Vencer</strong>
        <p>Dados importados da planilha de estoque.</p>
      </footer>

      {selected && (
        <div className="modal-backdrop" role="presentation" onClick={() => setSelected(null)}>
          <section className="detail-modal" role="dialog" aria-modal="true" aria-label="Detalhes do lote" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)} aria-label="Fechar detalhes">×</button>
            <span className={`status ${statusFor(dayDiff(selected.expiry)).tone}`}>{statusFor(dayDiff(selected.expiry)).label}</span>
            <p className="detail-code">Cód. {selected.productCode}</p>
            <h2>{selected.product}</h2>
            <p className="detail-supplier">{selected.supplier}</p>
            <div className="detail-grid">
              <div><span>Validade</span><strong>{date.format(parseDate(selected.expiry))}</strong></div>
              <div><span>Lote</span><strong>{selected.lot}</strong></div>
              <div><span>Grupo</span><strong>{selected.group}</strong></div>
              <div><span>Empresa</span><strong>{selected.company}</strong></div>
              <div><span>Estoque</span><strong>{number.format(selected.stock)}</strong></div>
              <div><span>Custo unitário</span><strong>{money.format(unitCost(selected))}</strong></div>
            </div>
            <div className="detail-total"><span>Total em estoque</span><strong>{money.format(selected.totalCost)}</strong></div>
          </section>
        </div>
      )}
    </main>
  );
}
