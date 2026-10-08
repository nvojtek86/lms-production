"use client";
import {useUi} from "@/i18n/useUi";


import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CertificateNamePlacement = {
  page: number; // 1-based
  xPct: number; // from left, 0..1
  yPct: number; // from top, 0..1
  wPct?: number; // 0..1 (optional)
  hPct?: number; // 0..1 (optional)
  fontSize?: number;
  fontFamily?: "helvetica" | "helvetica_bold" | "times" | "times_bold" | "courier" | "courier_bold";
  color?: string;
  align?: "left" | "center" | "right";
};

const PREVIEW_NAME = "Olivia Jane";
const COLOR_PRESETS: Array<{ label: string; hex: string }> = [
  { label: "Black", hex: "#111111" },
  { label: "Slate", hex: "#334155" },
  { label: "Navy", hex: "#0f172a" },
  { label: "Emerald", hex: "#047857" },
  { label: "Orange", hex: "#F58131" },
  { label: "Purple", hex: "#6d28d9" },
];

export function CertificatePlacementModal({
  open,
  templateMime,
  templateDownloadUrl,
  initialPlacement,
  onClose,
  onSave,
}: {
  open: boolean;
  templateMime: string;
  templateDownloadUrl: string;
  initialPlacement: CertificateNamePlacement | null;
  onClose: () => void;
  onSave: (placement: CertificateNamePlacement) => void;
}) {
  const ui = useUi();
  const isPdf = templateMime === "application/pdf";
  const isImage = templateMime.startsWith("image/");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const pdfjsRef = useRef<unknown>(null);

  const [pageCount, setPageCount] = useState<number>(1);
  const [page, setPage] = useState<number>(initialPlacement?.page ?? 1);

  // Placement box (stored in % relative to current page viewport)
  const [placement, setPlacement] = useState<CertificateNamePlacement>(() => {
    return (
      initialPlacement ?? {
        page: 1,
        xPct: 0.5,
        yPct: 0.7,
        wPct: 0.42,
        hPct: 0.08,
        fontSize: 32,
        fontFamily: "helvetica_bold",
        color: "#111111",
        align: "center",
      }
    );
  });

  // Keep placement.page in sync with current page state
  useEffect(() => {
    if (!open) return;
    setPlacement((p) => ({ ...p, page }));
  }, [page, open]);

  // Load bytes when opened
  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    setBytes(null);
    setImgUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(templateDownloadUrl, { method: "GET" });
        if (!res.ok) throw new Error(`Failed to load template (${res.status})`);
        const ab = await res.arrayBuffer();
        if (cancelled) return;
        setBytes(ab);
        if (isImage) {
          const blob = new Blob([ab], { type: templateMime });
          setImgUrl(URL.createObjectURL(blob));
        }
      } catch (e) {
        if (cancelled) return;
        setError(ui(e instanceof Error ? e.message : "Failed to load template"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, templateDownloadUrl]);

  // Render PDF page into canvas
  useEffect(() => {
    if (!open) return;
    if (!isPdf) return;
    if (!bytes) return;
    if (typeof window === "undefined") return;

    let destroyed = false;
    (async () => {
      try {
        // Lazy-load pdfjs only in browser to avoid DOMMatrix issues on the server.
        const g = globalThis as unknown as { __pdfjsWorkerConfigured?: boolean };
        const loaded = pdfjsRef.current
          ? pdfjsRef.current
          : await import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
              pdfjsRef.current = m;
              return m as unknown;
            });

        const pdfjs = loaded as unknown as {
          GlobalWorkerOptions: { workerSrc: string };
          getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<unknown> }> };
        };

        if (!g.__pdfjsWorkerConfigured) {
          try {
            pdfjs.GlobalWorkerOptions.workerSrc = new URL(
              "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
              import.meta.url
            ).toString();
            g.__pdfjsWorkerConfigured = true;
          } catch {
            // ignore (best-effort)
          }
        }

        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        if (destroyed) return;
        setPageCount(doc.numPages || 1);

        const safePage = Math.max(1, Math.min(page, doc.numPages || 1));
        if (safePage !== page) setPage(safePage);

        const pUnknown = await doc.getPage(safePage);
        const p = pUnknown as unknown as {
          getViewport: (args: { scale: number }) => { width: number; height: number };
          render: (args: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<unknown> };
        };
        if (destroyed) return;

        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const viewport0 = p.getViewport({ scale: 1 });
        const maxW = Math.max(320, Math.floor(container.clientWidth));
        const scale = maxW / viewport0.width;
        const viewport = p.getViewport({ scale });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        await p.render({ canvasContext: ctx, viewport }).promise;
      } catch (e) {
        if (!destroyed) setError(ui(e instanceof Error ? e.message : "Failed to render PDF"));
      }
    })();

    return () => {
      destroyed = true;
    };
  }, [open, isPdf, bytes, page, ui]);

  const viewportSize = (() => {
    const canvas = canvasRef.current;
    if (isPdf && canvas) return { w: canvas.width, h: canvas.height };
    const container = containerRef.current;
    if (isImage && container) return { w: container.clientWidth, h: container.clientHeight };
    return { w: 0, h: 0 };
  })();

  const boxPx = useMemo(() => {
    const w = Math.max(0, viewportSize.w);
    const h = Math.max(0, viewportSize.h);
    const wPct = placement.wPct ?? 0.42;
    const hPct = placement.hPct ?? 0.08;
    return {
      x: Math.round(placement.xPct * w),
      y: Math.round(placement.yPct * h),
      w: Math.round(wPct * w),
      h: Math.round(hPct * h),
    };
  }, [placement, viewportSize]);

  function clamp01(n: number) {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  function applyDrag(dx: number, dy: number) {
    const w = viewportSize.w || 1;
    const h = viewportSize.h || 1;
    setPlacement((prev) => ({
      ...prev,
      xPct: clamp01((prev.xPct * w + dx) / w),
      yPct: clamp01((prev.yPct * h + dy) / h),
    }));
  }

  type DragMode = "drag" | "resize";
  const dragRef = useRef<{
    active: boolean;
    mode: DragMode;
    edgeX: -1 | 0 | 1; // -1 = left edge, 1 = right edge
    edgeY: -1 | 0 | 1; // -1 = top edge, 1 = bottom edge
    lastX: number;
    lastY: number;
  }>({ active: false, mode: "drag", edgeX: 0, edgeY: 0, lastX: 0, lastY: 0 });

  function clampFontSize(n: number) {
    if (!Number.isFinite(n)) return 32;
    return Math.max(6, Math.min(200, Math.round(n)));
  }

  function applyResize(dx: number, dy: number, edgeX: -1 | 0 | 1, edgeY: -1 | 0 | 1) {
    const w = viewportSize.w || 1;
    const h = viewportSize.h || 1;
    const minW = 60;
    const minH = 26;

    setPlacement((prev) => {
      const curW = Math.max(minW, Math.round((prev.wPct ?? 0.42) * w));
      const curH = Math.max(minH, Math.round((prev.hPct ?? 0.08) * h));
      const curX = clamp01(prev.xPct) * w;
      const curY = clamp01(prev.yPct) * h;

      const nextW = Math.max(minW, Math.min(w, curW + dx * edgeX));
      const nextH = Math.max(minH, Math.min(h, curH + dy * edgeY));

      const nextX = edgeX !== 0 ? curX + dx / 2 : curX;
      const nextY = edgeY !== 0 ? curY + dy / 2 : curY;

      return {
        ...prev,
        xPct: clamp01(nextX / w),
        yPct: clamp01(nextY / h),
        wPct: clamp01(nextW / w),
        hPct: clamp01(nextH / h),
      };
    });
  }

  function onBoxMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement | null;
    const rect = el ? el.getBoundingClientRect() : null;
    const threshold = 10;
    let edgeX: -1 | 0 | 1 = 0;
    let edgeY: -1 | 0 | 1 = 0;
    if (rect) {
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      const nearLeft = ox <= threshold;
      const nearRight = rect.width - ox <= threshold;
      const nearTop = oy <= threshold;
      const nearBottom = rect.height - oy <= threshold;
      edgeX = nearLeft ? -1 : nearRight ? 1 : 0;
      edgeY = nearTop ? -1 : nearBottom ? 1 : 0;
    }
    const mode: DragMode = edgeX !== 0 || edgeY !== 0 ? "resize" : "drag";
    dragRef.current = { active: true, mode, edgeX, edgeY, lastX: e.clientX, lastY: e.clientY };
  }

  useEffect(() => {
    if (!open) return;
    function onMove(e: MouseEvent) {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      if (dragRef.current.mode === "resize") {
        applyResize(dx, dy, dragRef.current.edgeX, dragRef.current.edgeY);
      } else {
        applyDrag(dx, dy);
      }
    }
    function onUp() {
      dragRef.current.active = false;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewportSize.w, viewportSize.h]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-100000 bg-black/50 p-3 sm:p-6" role="dialog" aria-modal="true">
      <div className="mx-auto h-[calc(100svh-24px)] sm:h-[calc(100svh-48px)] max-w-[1100px]">
        <div className="h-full rounded-2xl border bg-white shadow-2xl overflow-hidden flex flex-col">
          <div
            style={{
              background: "linear-gradient(135deg, #0e4d2c 0%, #1b6b3a 50%, #2d8f52 100%)",
              color: "#fff",
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: "14px" }}>{ui("🏆 Place member name")}</div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.25)" }}
              aria-label={ui("Close")}
              title={ui("Close")}
            >
              <X className="h-4 w-4 text-white" />
            </button>
          </div>

          <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[1fr_320px]">
            {/* Preview */}
            <div className="relative overflow-auto bg-linear-to-br from-slate-50 to-white p-4">
              <div className="mx-auto w-full max-w-[860px]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    {ui("Drag the highlighted box to choose where the learner’s ")}<span className="font-semibold text-foreground">{ui("Full name")}</span> {ui("will be printed.")}</div>
                  {isPdf ? (
                    <div className="flex items-center gap-2">
                      <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <div className="text-xs text-muted-foreground">
                        {ui("Page ")}<span className="font-semibold text-foreground">{page}</span> / {pageCount}
                      </div>
                      <Button type="button" size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div
                  ref={containerRef}
                  className="relative mx-auto rounded-xl border bg-white shadow-sm overflow-hidden"
                  style={{ maxWidth: "860px" }}
                >
                  {loading ? (
                    <div className="p-10 text-sm text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {ui("Loading template…")}</div>
                  ) : error ? (
                    <div className="p-10 text-sm text-destructive">{ui(error)}</div>
                  ) : isPdf ? (
                    <canvas ref={canvasRef} style={{ width: "100%", height: "auto", display: "block" }} />
                  ) : isImage && imgUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt={ui("Certificate template preview")} src={imgUrl} style={{ width: "100%", height: "auto", display: "block" }} />
                  ) : (
                    <div className="p-10 text-sm text-muted-foreground">{ui("Unsupported template type.")}</div>
                  )}

                  {/* Placement box */}
                  {!loading && !error ? (
                    <div
                      role="button"
                      tabIndex={0}
                      onMouseDown={onBoxMouseDown}
                      className={cn("absolute select-none group")}
                      style={{
                        left: `${Math.max(0, boxPx.x - Math.round(boxPx.w / 2))}px`,
                        top: `${Math.max(0, boxPx.y - Math.round(boxPx.h / 2))}px`,
                        width: `${Math.max(60, boxPx.w)}px`,
                        height: `${Math.max(26, boxPx.h)}px`,
                        borderRadius: "10px",
                        border: "2px dashed rgba(27,107,184,0.65)",
                        background: "linear-gradient(135deg, rgba(27,107,184,0.12) 0%, rgba(124,58,189,0.07) 100%)",
                        boxShadow: "0 6px 20px rgba(27,107,184,0.18)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "move",
                        padding: "6px 10px",
                      }}
                      title={ui("Drag to position (resize from edges)")}
                    >
                      {/* Resize hints (visual only; resizing is edge-detection on the box) */}
                      <div className="pointer-events-none absolute -left-1 -top-1 h-5 w-5 rounded-md border bg-white/90 shadow-sm opacity-0 transition-opacity group-hover:opacity-100 flex items-center justify-center">
                        <span className="text-[12px] font-bold text-slate-700">+</span>
                      </div>
                      <div className="pointer-events-none absolute -right-1 -top-1 h-5 w-5 rounded-md border bg-white/90 shadow-sm opacity-0 transition-opacity group-hover:opacity-100 flex items-center justify-center">
                        <span className="text-[12px] font-bold text-slate-700">+</span>
                      </div>
                      <div className="pointer-events-none absolute -left-1 -bottom-1 h-5 w-5 rounded-md border bg-white/90 shadow-sm opacity-0 transition-opacity group-hover:opacity-100 flex items-center justify-center">
                        <span className="text-[12px] font-bold text-slate-700">+</span>
                      </div>
                      <div className="pointer-events-none absolute -right-1 -bottom-1 h-5 w-5 rounded-md border bg-white/90 shadow-sm opacity-0 transition-opacity group-hover:opacity-100 flex items-center justify-center">
                        <span className="text-[12px] font-bold text-slate-700">+</span>
                      </div>

                      <span
                        style={{
                          fontWeight: 800,
                          color: placement.color ?? "#111111",
                          fontSize: `${Math.max(12, Math.min(72, Number(placement.fontSize ?? 32) * 0.65))}px`,
                          textAlign: placement.align ?? "center",
                          width: "100%",
                          lineHeight: 1.05,
                          fontFamily:
                            placement.fontFamily === "times" || placement.fontFamily === "times_bold"
                              ? "ui-serif, Georgia, 'Times New Roman', serif"
                              : placement.fontFamily === "courier" || placement.fontFamily === "courier_bold"
                                ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
                                : "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
                        }}
                      >
                        {PREVIEW_NAME}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="border-l bg-white p-4 space-y-4 overflow-auto">
              <div className="rounded-xl border p-4">
                <div className="text-sm font-semibold text-foreground">{ui("Placement")}</div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {ui("Current: page ")}{placement.page}, x {Math.round(placement.xPct * 100)}%, y {Math.round(placement.yPct * 100)}%
                </div>
              </div>

              <div className="rounded-xl border p-4 space-y-2">
                <div className="text-sm font-semibold text-foreground">{ui("Preview text")}</div>
                <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm font-semibold">{PREVIEW_NAME}</div>
                <div className="text-xs text-muted-foreground">{ui("We’ll replace this with the learner’s full name when generating certificates.")}</div>
              </div>

              <div className="rounded-xl border p-4 space-y-3">
                <div className="text-sm font-semibold text-foreground">{ui("Font")}</div>
                <select
                  className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                  value={placement.fontFamily ?? "helvetica_bold"}
                  onChange={(e) => {
                    const v = e.target.value as CertificateNamePlacement["fontFamily"];
                    setPlacement((p) => ({ ...p, fontFamily: v }));
                  }}
                >
                  <option value="helvetica_bold">{ui("Helvetica Bold")}</option>
                  <option value="helvetica">{ui("Helvetica")}</option>
                  <option value="times_bold">{ui("Times Bold")}</option>
                  <option value="times">{ui("Times")}</option>
                  <option value="courier_bold">{ui("Courier Bold")}</option>
                  <option value="courier">{ui("Courier")}</option>
                </select>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">{ui("Font size (px)")}</span>
                  <input
                    className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                    type="number"
                    min={6}
                    max={200}
                    step={1}
                    value={placement.fontSize ?? 32}
                    onChange={(e) => {
                      const next = clampFontSize(Number(e.target.value));
                      setPlacement((p) => ({ ...p, fontSize: next }));
                    }}
                  />
                </label>
                <div className="text-xs text-muted-foreground">{ui("Uses PDF built-in fonts for maximum compatibility.")}</div>
              </div>

              <div className="rounded-xl border p-4 space-y-3">
                <div className="text-sm font-semibold text-foreground">{ui("Color")}</div>
                <div className="grid grid-cols-3 gap-2">
                  {COLOR_PRESETS.map((c) => {
                    const selected = (placement.color ?? "#111111").toLowerCase() === c.hex.toLowerCase();
                    return (
                      <button
                        key={c.hex}
                        type="button"
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-2 py-2 text-left text-xs transition",
                          selected ? "border-foreground/40 bg-muted/20" : "hover:bg-muted/10"
                        )}
                        onClick={() => setPlacement((p) => ({ ...p, color: c.hex }))}
                      >
                        <span
                          className={cn("h-4 w-4 rounded-md border", selected ? "ring-2 ring-offset-1 ring-foreground/30" : "")}
                          style={{ background: c.hex }}
                          aria-hidden="true"
                        />
                        <span className="truncate">{ui(c.label)}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="text-xs text-muted-foreground">{ui("This color will be used for the learner’s name on the generated PDF.")}</div>
              </div>

              <div className="pt-2 flex items-center justify-between gap-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  {ui("Cancel")}</Button>
                <Button
                  type="button"
                  onClick={() => {
                    onSave({
                      page,
                      xPct: Math.max(0, Math.min(1, placement.xPct)),
                      yPct: Math.max(0, Math.min(1, placement.yPct)),
                      wPct: placement.wPct ?? 0.42,
                      hPct: placement.hPct ?? 0.08,
                      fontSize: placement.fontSize ?? 32,
                      fontFamily: placement.fontFamily ?? "helvetica_bold",
                      color: placement.color ?? "#111111",
                      align: placement.align ?? "center",
                    });
                  }}
                  className="gap-2"
                >
                  <Check className="h-4 w-4" />
                  {ui("Save placement")}</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

