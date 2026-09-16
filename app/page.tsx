"use client";

import { useEffect, useMemo, useState } from "react";
import inventoryData from "./data/inventory.json";

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

type RangeFilter = "period" | "expired" | "30" | "60" | "120" | "all";
type Tab = "products" | "suppliers";

const items = inventoryData as Item[];
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("pt-BR");

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
    item.stock ? item.totalCost / item.stock : 0,
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
  const [tab, setTab] = useState<Tab>("products");
  const [range, setRange] = useState<RangeFilter>("period");
  const [search, setSearch] = useState("");
  const [supplier, setSupplier] = useState("all");
  const [group, setGroup] = useState("all");
  const [visible, setVisible] = useState(18);
  const [selected, setSelected] = useState<Item | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [installEvent, setInstallEvent] = useState<Event | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
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
    return {
      expired: expired.length,
      expiredValue: expired.reduce((sum, item) => sum + item.totalCost, 0),
      d30: d30.length,
      d30Value: d30.reduce((sum, item) => sum + item.totalCost, 0),
      d120: d120.length,
      d120Value: d120.reduce((sum, item) => sum + item.totalCost, 0),
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
          (range === "120" && days >= 0 && days <= 120);
        const matchesTerm = !term || normalized(`${item.product} ${item.productCode} ${item.lot} ${item.supplier}`).includes(term);
        return inRange && matchesTerm && (supplier === "all" || item.supplier === supplier) && (group === "all" || item.group === group);
      })
      .sort((a, b) => dayDiff(a.expiry) - dayDiff(b.expiry));
  }, [range, search, supplier, group]);

  const supplierReport = useMemo(() => {
    const report = new Map<string, { lots: number; value: number; expired: number; next120: number }>();
    filtered.forEach((item) => {
      const current = report.get(item.supplier) ?? { lots: 0, value: 0, expired: 0, next120: 0 };
      const days = dayDiff(item.expiry);
      current.lots += 1;
      current.value += item.totalCost;
      if (days < 0) current.expired += 1;
      if (days >= 0 && days <= 120) current.next120 += 1;
      report.set(item.supplier, current);
    });
    return [...report.entries()].map(([name, values]) => ({ name, ...values })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const totalFiltered = filtered.reduce((sum, item) => sum + item.totalCost, 0);
  const maxSupplierValue = Math.max(...supplierReport.map((entry) => entry.value), 1);
  const hasExtraFilters = supplier !== "all" || group !== "all";

  function selectRange(value: RangeFilter) {
    setRange(value);
    setVisible(18);
    setTab("products");
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
        <div className="brand-mark" aria-hidden="true">V</div>
        <div className="brand-copy">
          <strong>Validade em Dia</strong>
          <span>Controle de estoque · CONFIAN-GO</span>
        </div>
        <button className="install-button" onClick={installApp} aria-label="Instalar aplicativo no celular">
          <span aria-hidden="true">↓</span> Instalar
        </button>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">Painel de atenção</p>
          <h1>Produtos por validade</h1>
          <p>Acompanhe lotes vencidos e a vencer nos próximos 120 dias.</p>
        </div>
        <div className="updated"><span className="live-dot" /> Base: 16/09/2026</div>
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
      </section>

      <nav className="tabs" aria-label="Seções do aplicativo">
        <button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}>Produtos</button>
        <button className={tab === "suppliers" ? "active" : ""} onClick={() => setTab("suppliers")}>Fornecedores</button>
      </nav>

      <section className="controls">
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input value={search} onChange={(event) => { setSearch(event.target.value); setVisible(18); }} placeholder="Buscar produto, código ou lote" />
          {search && <button onClick={() => setSearch("")} aria-label="Limpar busca">×</button>}
        </label>
        <button className={`filter-button ${hasExtraFilters ? "active" : ""}`} onClick={() => setFiltersOpen((value) => !value)}>
          Filtros {hasExtraFilters && <span>•</span>}
        </button>
        <button className="export-button" onClick={() => downloadCsv(filtered)}>Exportar CSV</button>
      </section>

      {filtersOpen && (
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
          <label>Período
            <select value={range} onChange={(event) => selectRange(event.target.value as RangeFilter)}>
              <option value="period">Vencidos + próximos 120 dias</option>
              <option value="expired">Somente vencidos</option>
              <option value="30">Próximos 30 dias</option>
              <option value="60">Próximos 60 dias</option>
              <option value="120">Próximos 120 dias</option>
              <option value="all">Todo o estoque</option>
            </select>
          </label>
          {hasExtraFilters && <button className="clear-filters" onClick={() => { setSupplier("all"); setGroup("all"); }}>Limpar filtros</button>}
        </section>
      )}

      <section className="result-heading">
        <div>
          <p>{tab === "products" ? "Lotes encontrados" : "Resumo por fornecedor"}</p>
          <strong>{tab === "products" ? `${filtered.length} registros` : `${supplierReport.length} fornecedores`}</strong>
        </div>
        <div className="result-value"><span>Valor em estoque</span><strong>{money.format(totalFiltered)}</strong></div>
      </section>

      {tab === "products" ? (
        <section className="product-list" aria-live="polite">
          {filtered.slice(0, visible).map((item, index) => {
            const days = dayDiff(item.expiry);
            const status = statusFor(days);
            return (
              <article className="product-card" key={`${item.productCode}-${item.lot}-${index}`} onClick={() => setSelected(item)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && setSelected(item)}>
                <div className="card-topline">
                  <span className={`status ${status.tone}`}>{status.label}</span>
                  <span className="code">Cód. {item.productCode}</span>
                </div>
                <h2>{item.product}</h2>
                <p className="supplier">{item.supplier}</p>
                <div className="product-facts">
                  <div><span>Validade</span><strong>{date.format(parseDate(item.expiry))}</strong></div>
                  <div><span>Lote</span><strong>{item.lot}</strong></div>
                  <div><span>Estoque</span><strong>{number.format(item.stock)}</strong></div>
                  <div className="cost"><span>Valor</span><strong>{money.format(item.totalCost)}</strong></div>
                </div>
              </article>
            );
          })}
          {filtered.length === 0 && <div className="empty-state"><strong>Nenhum lote encontrado</strong><p>Altere a busca ou os filtros para ver outros produtos.</p></div>}
          {visible < filtered.length && <button className="load-more" onClick={() => setVisible((value) => value + 18)}>Mostrar mais {Math.min(18, filtered.length - visible)} lotes</button>}
        </section>
      ) : (
        <section className="supplier-list">
          {supplierReport.map((entry, index) => (
            <article className="supplier-card" key={entry.name}>
              <div className="supplier-rank">{String(index + 1).padStart(2, "0")}</div>
              <div className="supplier-main">
                <h2>{entry.name}</h2>
                <div className="bar"><span style={{ width: `${Math.max((entry.value / maxSupplierValue) * 100, 2)}%` }} /></div>
                <div className="supplier-metrics">
                  <span><strong>{entry.lots}</strong> lotes</span>
                  <span><strong>{entry.expired}</strong> vencidos</span>
                  <span><strong>{entry.next120}</strong> até 120d</span>
                </div>
              </div>
              <div className="supplier-value"><span>Valor</span><strong>{money.format(entry.value)}</strong></div>
            </article>
          ))}
        </section>
      )}

      <footer><span>Validade em Dia</span><p>Dados importados da planilha de estoque.</p></footer>

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
              <div><span>Custo unitário</span><strong>{money.format(selected.stock ? selected.totalCost / selected.stock : 0)}</strong></div>
            </div>
            <div className="detail-total"><span>Valor total em estoque</span><strong>{money.format(selected.totalCost)}</strong></div>
          </section>
        </div>
      )}
    </main>
  );
}
