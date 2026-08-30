"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  UploadCloud,
  FileBox,
  DollarSign,
  Clock,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Plus,
  Minus,
  Zap,
} from "lucide-react";
import Script from "next/script";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ParsedMeshData } from "@/components/stepmesh";

// Loads three.js + the WASM STEP parser only in the browser, only once a file exists.
const PartViewer = dynamic(() => import("@/components/partviewer"), { ssr: false });
// Lightweight per-component viewer — no WASM, just renders geometry it's handed.
const ComponentViewer = dynamic(() => import("@/components/componentviewer"), { ssr: false });

const INK = "#14171A";
const ACCENT = "#FF5C1A";
const ACCENT_DARK = "#E64F12";
const PAPER = "#F7F6F3";
const HAIRLINE = "#E4E2DC";

const STAGES = [
  "Reading STEP geometry kernel…",
  "Detecting machinable features…",
  "Solving toolpaths & setups…",
  "Pricing against shop rates…",
];

export default function QuotingApp() {
  const [pyodide, setPyodide] = useState<any>(null);
  const [isPythonReady, setIsPythonReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [quoteResults, setQuoteResults] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [parsedMeshes, setParsedMeshes] = useState<ParsedMeshData[] | null>(null);
  const [meshParseFailed, setMeshParseFailed] = useState(false);

  // Order controls — cosmetic/local, scale the quoted unit price for display.
  const [quantity, setQuantity] = useState(1);
  const [leadTime, setLeadTime] = useState<"standard" | "expedite">("standard");
  const [stageIdx, setStageIdx] = useState(0);

  const [jobId] = useState(() => {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
      d.getDate()
    ).padStart(2, "0")}`;
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `CNC-${stamp}-${rand}`;
  });

  useEffect(() => {
    async function loadPyodideEnvironment() {
      try {
        // @ts-ignore
        const py = await loadPyodide({
          indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/",
        });
        setPyodide(py);
        setIsPythonReady(true);
      } catch (err) {
        console.warn("Failed to load Pyodide natively, falling back to mock UI for testing.", err);
        setIsPythonReady(true);
      }
    }

    if (typeof window !== "undefined" && (window as any).loadPyodide) {
      loadPyodideEnvironment();
    }
  }, []);

  // Advance through processing "stages" once, then hold on the last one — never wraps back to
  // the start, so the bar can't visibly reset if the backend takes longer than one full cycle.
  useEffect(() => {
    if (!isProcessing) {
      setStageIdx(0);
      return;
    }
    const id = setInterval(() => {
      setStageIdx((i) => Math.min(i + 1, STAGES.length - 1));
    }, 900);
    return () => clearInterval(id);
  }, [isProcessing]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    setQuoteResults(null);
    setQuantity(1);
    setLeadTime("standard");
    setUploadedFile(file);
    setParsedMeshes(null);
    setMeshParseFailed(false);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("http://localhost:8000/api/quote", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Failed to process CAD file on backend.");

      const data = await response.json();
      setQuoteResults(data);
    } catch (err: any) {
      setError(err.message || "An error occurred connecting to the CAD processing service.");
    } finally {
      setIsProcessing(false);
    }
  };

  const meshesResolved = parsedMeshes !== null || meshParseFailed;

  // Map parsed bodies to billed components. Assumes occt-import-js returns bodies in the same
  // order the backend split them into components — if the counts don't match (e.g. the backend
  // groups multiple bodies into one billed component), fall back to showing the whole model for
  // every section rather than guessing which body belongs to which line item.
  const componentMeshSets = useMemo(() => {
    if (!quoteResults) return [];
    if (!parsedMeshes) return quoteResults.map(() => undefined);
    const sameCount = parsedMeshes.length === quoteResults.length;
    return quoteResults.map((_, idx) => (sameCount ? [parsedMeshes[idx]] : parsedMeshes));
  }, [parsedMeshes, quoteResults]);

  return (
    <div className="min-h-screen p-8" style={{ backgroundColor: PAPER, color: INK }}>
      <Script src="https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js" strategy="beforeInteractive" />

      <main className="mx-auto max-w-5xl space-y-8">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6" style={{ borderColor: HAIRLINE }}>
          <div>
            <div
              className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em]"
              style={{ color: ACCENT }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ACCENT }} />
              Automated Shop Floor
            </div>
            <h1 className="text-3xl font-black uppercase tracking-tight">Instant CNC Quote</h1>
            <p className="mt-1 text-sm text-slate-500">
              Upload a STEP file — get machining cost and lead time back in seconds.
            </p>
          </div>
          <div
            className="flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 font-mono text-xs"
            style={{ borderColor: HAIRLINE }}
          >
            <span className="relative flex h-2 w-2">
              <span
                className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                  isPythonReady ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  isPythonReady ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
            </span>
            <span className="text-slate-400">SYS</span>
            <span className="font-semibold">{isPythonReady ? "READY" : "BOOTING"}</span>
          </div>
        </header>

        {/* Upload zone — disappears the moment a file is picked */}
        {!uploadedFile && (
          <div
            className="group relative overflow-hidden rounded-2xl border-2 border-dashed bg-white p-16 text-center transition-colors"
            style={{
              borderColor: "#D8D5CC",
              backgroundImage:
                "linear-gradient(#EFEDE7 1px, transparent 1px), linear-gradient(90deg, #EFEDE7 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          >
            <input
              type="file"
              accept=".step,.stp"
              onChange={handleFileUpload}
              disabled={!isPythonReady}
              className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            />

            <div className="flex flex-col items-center space-y-4">
              <div
                className="rounded-2xl p-4 transition-transform group-hover:scale-105"
                style={{ backgroundColor: "#FFF1E8", color: ACCENT }}
              >
                <UploadCloud size={40} />
              </div>
              <div className="space-y-1">
                <h3 className="text-xl font-semibold">Drag & drop your CAD file</h3>
                <p className="text-sm text-slate-500">Click to browse, or drop a file anywhere in this zone</p>
              </div>
              <Button className="pointer-events-none mt-2 text-white" style={{ backgroundColor: INK }}>
                Select File
              </Button>
              <p className="pt-2 font-mono text-[11px] uppercase tracking-widest text-slate-400">
                Format: STEP / STP · Max 50MB · Tolerance ±0.1mm
              </p>
            </div>
          </div>
        )}

        {/* Part preview — parses the STEP file in-browser, independent of the backend quote call.
            Only shown before results arrive; each component gets its own preview afterward. */}
        {uploadedFile && !quoteResults && (
          <PartViewer
            file={uploadedFile}
            analyzing={isProcessing}
            stageLabel={STAGES[stageIdx]}
            stageProgress={((stageIdx + 1) / STAGES.length) * 100}
            onMeshesParsed={setParsedMeshes}
            onMeshesError={() => setMeshParseFailed(true)}
          />
        )}

        {/* Error state */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle className="flex items-center justify-between gap-4">
              Connection Error
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setUploadedFile(null);
                }}
                className="font-mono text-[11px] font-normal uppercase tracking-widest underline underline-offset-2"
              >
                Try again
              </button>
            </AlertTitle>
            <AlertDescription className="mt-1 font-mono text-xs">{error}</AlertDescription>
          </Alert>
        )}

        {/* Results */}
        {quoteResults && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
            {/* Ticket header */}
            <div
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-white px-5 py-4"
              style={{ borderColor: HAIRLINE }}
            >
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <div>
                  <div className="font-semibold">Quote generated</div>
                  <div className="font-mono text-xs text-slate-400">JOB #{jobId}</div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuoteResults(null);
                  setUploadedFile(null);
                }}
              >
                Upload another file
              </Button>
            </div>

            {!meshesResolved && (
              <div
                className="flex items-center gap-2 rounded-xl border bg-white px-5 py-4 text-sm text-slate-500"
                style={{ borderColor: HAIRLINE }}
              >
                <span
                  className="h-3 w-3 animate-spin rounded-full border-2 border-slate-200"
                  style={{ borderTopColor: ACCENT }}
                />
                Finalizing 3D previews…
              </div>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Component sections — one per billed component, each with its own preview + cost breakdown */}
              <div className="space-y-6 lg:col-span-2">
                {quoteResults.map((part, idx) => (
                  <ComponentSection key={part.component_id ?? idx} part={part} meshes={componentMeshSets[idx]} />
                ))}
              </div>

              {/* Single consolidated order summary, sticky in the sidebar */}
              <div className="lg:col-span-1">
                <OrderSummaryCard
                  parts={quoteResults}
                  quantity={quantity}
                  setQuantity={setQuantity}
                  leadTime={leadTime}
                  setLeadTime={setLeadTime}
                />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Metric({ label, value, flagged = false }: { label: string; value: string; flagged?: boolean }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: HAIRLINE, backgroundColor: "#FBFAF8" }}>
      <div
        className="mb-1 font-mono text-[11px] uppercase tracking-wider"
        style={{ color: flagged ? "#E14A3B" : "#8A8F98" }}
      >
        {label}
      </div>
      <div className="font-mono text-lg font-semibold" style={{ color: flagged ? "#E14A3B" : INK }}>
        {value}
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </div>
  );
}

function TimeRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="font-mono font-medium">{value.toFixed(1)} min</span>
    </div>
  );
}

function CostRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span>${value.toFixed(2)}</span>
    </div>
  );
}

function ComponentSection({ part, meshes }: { part: any; meshes?: ParsedMeshData[] }) {
  const totalTime = Math.max(part.times_min.total_time, 0.0001);
  const setupPct = (part.times_min.setup_time / totalTime) * 100;
  const roughPct = (part.times_min.rough_time / totalTime) * 100;
  const finishPct = (part.times_min.finish_time / totalTime) * 100;
  const unitPrice = part.costs_cad.total_price;
  const hasFlags = part.metrics.sharp_internal_edges > 0;

  return (
    <div className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: HAIRLINE }}>
      {/* Section header */}
      <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: HAIRLINE }}>
        <div className="flex items-center gap-2">
          <FileBox className="h-5 w-5 text-slate-400" />
          <h3 className="text-lg font-semibold">Component {part.component_id}</h3>
        </div>
        <span className="font-mono text-sm font-semibold">${unitPrice.toFixed(2)}</span>
      </div>

      {/* DFM banner */}
      <div className="px-6 pt-5">
        {hasFlags ? (
          <div
            className="flex items-start gap-3 rounded-lg border px-4 py-3"
            style={{ borderColor: "#F3C7B9", backgroundColor: "#FFF4F0" }}
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#E14A3B" }} />
            <p className="text-sm" style={{ color: "#8A2E1F" }}>
              <span className="font-semibold">
                {part.metrics.sharp_internal_edges} sharp internal edge
                {part.metrics.sharp_internal_edges > 1 ? "s" : ""} detected.
              </span>{" "}
              Priced into Corner/EDM below — may require wire EDM or a smaller tool radius.
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <ShieldCheck className="h-4 w-4" /> No manufacturability flags on this part.
          </div>
        )}
      </div>

      {/* Preview alongside this component's cost breakdown */}
      <div className="grid grid-cols-1 gap-6 px-6 pt-5 lg:grid-cols-2">
        <ComponentViewer meshes={meshes} label={`Component ${part.component_id} Preview`} />
        <div>
          <div className="mb-3 font-mono text-[11px] uppercase tracking-widest text-slate-400">Cost Breakdown</div>
          <div className="space-y-2 text-sm">
            <CostLineLight label="Base Machining" value={part.costs_cad.base_machining} />
            <CostLineLight label="Hole Operations" value={part.costs_cad.feature_holes} />
            <CostLineLight label="Corner/EDM Penalties" value={part.costs_cad.feature_corners} />
            <div
              className="flex items-center justify-between border-t pt-2 font-semibold"
              style={{ borderColor: HAIRLINE }}
            >
              <span>Subtotal</span>
              <span className="font-mono">${unitPrice.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4 px-6 pt-5">
        <Metric
          label="Material Removed"
          value={`${part.metrics.removed_volume_mm3.toLocaleString(undefined, { maximumFractionDigits: 0 })} mm³`}
        />
        <Metric label="3-Axis Setups" value={String(part.metrics.setups_required)} />
        <Metric label="Drill Holes" value={String(part.metrics.drill_holes)} />
        <Metric label="Sharp Internal Edges" value={String(part.metrics.sharp_internal_edges)} flagged={hasFlags} />
      </div>

      {/* Timing */}
      <div className="space-y-3 px-6 py-5">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-slate-400">
          <Clock className="h-3.5 w-3.5" /> Manufacturing Time
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div style={{ width: `${setupPct}%`, backgroundColor: "#C9CDD3" }} />
          <div style={{ width: `${roughPct}%`, backgroundColor: ACCENT }} />
          <div style={{ width: `${finishPct}%`, backgroundColor: INK }} />
        </div>
        <div className="flex gap-4 font-mono text-[10px] uppercase tracking-wide text-slate-400">
          <LegendDot color="#C9CDD3" label="Setup" />
          <LegendDot color={ACCENT} label="Rough" />
          <LegendDot color={INK} label="Finish" />
        </div>
        <div className="space-y-2 border-t pt-3" style={{ borderColor: HAIRLINE }}>
          <TimeRow label="Setup & Fixturing" value={part.times_min.setup_time} />
          <TimeRow label="Roughing Toolpaths" value={part.times_min.rough_time} />
          <TimeRow label="Finishing Toolpaths" value={part.times_min.finish_time} />
          <div className="flex items-center justify-between border-t pt-3 font-semibold" style={{ borderColor: HAIRLINE }}>
            <span>Total Machine Time</span>
            <span className="font-mono">{part.times_min.total_time.toFixed(1)} min</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CostLineLight({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono">${value.toFixed(2)}</span>
    </div>
  );
}

function OrderSummaryCard({
  parts,
  quantity,
  setQuantity,
  leadTime,
  setLeadTime,
}: {
  parts: any[];
  quantity: number;
  setQuantity: React.Dispatch<React.SetStateAction<number>>;
  leadTime: "standard" | "expedite";
  setLeadTime: React.Dispatch<React.SetStateAction<"standard" | "expedite">>;
}) {
  const subtotal = parts.reduce((sum, p) => sum + p.costs_cad.total_price, 0);
  const leadMultiplier = leadTime === "expedite" ? 1.25 : 1;
  const total = subtotal * quantity * leadMultiplier;

  return (
    <div className="lg:sticky lg:top-8">
      <div className="relative overflow-hidden rounded-2xl text-white shadow-xl" style={{ backgroundColor: "#15181C" }}>
        {/* die-cut notches — sit behind the content below (z-0) */}
        <div className="absolute -top-2.5 left-8 z-0 h-5 w-5 rounded-full" style={{ backgroundColor: PAPER }} />
        <div className="absolute -top-2.5 right-8 z-0 h-5 w-5 rounded-full" style={{ backgroundColor: PAPER }} />

        <div className="relative z-10 p-6 pb-4 pt-7">
          <div className="mb-1 font-mono text-[11px] uppercase tracking-widest text-slate-400">
            {parts.length} Component{parts.length > 1 ? "s" : ""}
          </div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <DollarSign className="h-4 w-4" style={{ color: ACCENT }} /> Order Summary
          </h3>
        </div>

        <div className="relative z-10 mx-6 border-t border-dashed border-slate-700" />

        <div className="relative z-10 space-y-5 p-6 pt-5">
          <div className="space-y-2 font-mono text-sm">
            {parts.map((part, idx) => (
              <CostRow key={part.component_id ?? idx} label={`Component ${part.component_id}`} value={part.costs_cad.total_price} />
            ))}
          </div>

          {/* Quantity stepper */}
          <div className="flex items-center justify-between border-t border-slate-800 pt-4">
            <span className="text-sm text-slate-400">Order Quantity</span>
            <div className="flex items-center gap-3 rounded-lg border border-slate-700 px-1">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="p-1.5 text-slate-300 transition-colors hover:text-white"
                aria-label="Decrease quantity"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="w-6 text-center font-mono text-sm">{quantity}</span>
              <button
                type="button"
                onClick={() => setQuantity((q) => q + 1)}
                className="p-1.5 text-slate-300 transition-colors hover:text-white"
                aria-label="Increase quantity"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Lead time */}
          <div className="space-y-2">
            <span className="text-sm text-slate-400">Lead time</span>
            <div className="grid grid-cols-2 gap-2">
              <LeadTimeOption
                active={leadTime === "standard"}
                onClick={() => setLeadTime("standard")}
                title="Standard"
                subtitle="5–7 days"
              />
              <LeadTimeOption
                active={leadTime === "expedite"}
                onClick={() => setLeadTime("expedite")}
                title="Expedite"
                subtitle="2–3 days · +25%"
                icon={<Zap className="h-3 w-3" />}
              />
            </div>
          </div>

          {/* Total */}
          <div className="border-t border-slate-800 pt-4">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[11px] uppercase tracking-widest text-slate-400">
                Total ({quantity} {quantity > 1 ? "sets" : "set"})
              </span>
              <span className="font-mono text-[11px] text-slate-500">${subtotal.toFixed(2)} / set</span>
            </div>
            <div className="mt-1 font-mono text-4xl font-black" style={{ color: ACCENT }}>
              ${total.toFixed(2)}
            </div>
          </div>

          <Button
            className="w-full text-white shadow-lg"
            size="lg"
            style={{ backgroundColor: ACCENT }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = ACCENT_DARK)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = ACCENT)}
          >
            Add to Order
          </Button>
          <p className="text-center font-mono text-[10px] text-slate-500">
            Price locked for 30 days · No minimum order
          </p>
        </div>
      </div>
    </div>
  );
}

function LeadTimeOption({
  active,
  onClick,
  title,
  subtitle,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border px-3 py-2 text-left transition-colors"
      style={{
        borderColor: active ? ACCENT : "#334155",
        backgroundColor: active ? "rgba(255,92,26,0.1)" : "transparent",
      }}
    >
      <div className="flex items-center gap-1 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <div className="font-mono text-[11px] text-slate-400">{subtitle}</div>
    </button>
  );
}