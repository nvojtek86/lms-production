"use client";
import {useUi} from "@/i18n/useUi";


import { useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { fetchJson } from "@/lib/api";

type Item = { id: string; label: string; meta?: string | null };

export function AsyncIdCombobox({
  name,
  label,
  placeholder,
  initialId,
  initialLabel,
  disabled,
  pageSize = 20,
  fetchUrl,
}: {
  name: string; // submitted hidden input name (id)
  label: string;
  placeholder?: string; // input placeholder when empty
  hint?: string; // optional helper text under label
  initialId?: string;
  initialLabel?: string;
  disabled?: boolean;
  pageSize?: number;
  fetchUrl: (params: { q: string; page: number; page_size: number }) => string;
}) {
  const ui = useUi();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState(initialId ?? "");
  const [selectedLabel, setSelectedLabel] = useState(initialLabel ?? "");
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const reqId = useRef(0);

  const totalPages = useMemo(() => {
    const t = Math.max(0, total);
    return t > 0 ? Math.max(1, Math.ceil(t / pageSize)) : 1;
  }, [total, pageSize]);

  // Never show IDs in the input; only show the human-friendly label.
  const inputValue = open ? q : selectedLabel;
  const inputPlaceholder = placeholder ?? `Search ${label.toLowerCase()}...`;

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const el = wrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const myReq = ++reqId.current;

    setLoading(true);
    setError(null);

    const timer = setTimeout(async () => {
      try {
        const { data: body } = await fetchJson<Record<string, unknown>>(fetchUrl({ q, page, page_size: pageSize }), {
          method: "GET",
        });
        if (cancelled) return;
        if (myReq !== reqId.current) return;
        const bodyRec = (body && typeof body === "object" ? (body as Record<string, unknown>) : null);
        if (!bodyRec) throw new Error("Failed to load options");

        const list =
          (bodyRec?.items ?? bodyRec?.organizations ?? bodyRec?.users ?? bodyRec?.courses) as unknown;
        const raw = Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];

        const rawItems: Item[] = raw.map((r) => {
          const id = String(r.id ?? "");
          const label = String(r.label ?? r.name ?? r.email ?? r.title ?? r.slug ?? id);
          const meta = typeof r.meta === "string" ? r.meta : null;
          return { id, label, meta };
        });

        setItems(rawItems);
        setTotal(typeof bodyRec?.total === "number" ? bodyRec.total : 0);
      } catch (e) {
        setItems([]);
        setTotal(0);
        setError(ui(e instanceof Error ? e.message : "Failed to load options"));
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, q, page, pageSize, fetchUrl, ui]);

  function clearSelection() {
    setSelectedId("");
    setSelectedLabel("");
    setQ("");
    setPage(1);
  }

  function selectItem(it: Item) {
    setSelectedId(it.id);
    setSelectedLabel(it.label);
    setOpen(false);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <input type="hidden" name={name} value={selectedId} />
      <div className="text-xs text-muted-foreground mb-1">
        {ui(label)}
      </div>
      <div className="relative">
        <Input
          value={inputValue}
          placeholder={inputPlaceholder}
          disabled={disabled}
          className="pr-10"
          onFocus={() => {
            if (disabled) return;
            setOpen(true);
            setQ("");
            setPage(1);
          }}
          onChange={(e) => {
            if (!open) setOpen(true);
            setQ(e.target.value);
            setPage(1);
          }}
        />

        {/* Inline clear "X" button */}
        {!disabled && (selectedId || (open && q.length > 0)) ? (
          <button
            type="button"
            aria-label={ui("Clear")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-muted-foreground hover:bg-muted/50"
            onClick={() => {
              if (selectedId) {
                clearSelection();
                setOpen(true);
              } else {
                setQ("");
              }
            }}
          >
            X
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="absolute z-50 mt-2 w-full rounded-md border bg-card shadow-sm">
          <div className="px-3 py-2 text-xs text-muted-foreground border-b flex items-center justify-between gap-2">
            <span>
              {loading ? ui("Loading...") : ui("Page {v0} / {v1}", {v0: page, v1: totalPages})}{" "}
              {total ? ui("• {v0} total", {v0: total}) : ""}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                className="h-8 rounded-md border px-2 text-xs text-foreground disabled:opacity-50"
                disabled={loading || page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {ui("Prev")}</button>
              <button
                type="button"
                className="h-8 rounded-md border px-2 text-xs text-foreground disabled:opacity-50"
                disabled={loading || page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {ui("Next")}</button>
            </div>
          </div>

          {error ? (
            <div className="px-3 py-3 text-sm text-destructive">{ui(error)}</div>
          ) : items.length === 0 && !loading ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">{ui("No results.")}</div>
          ) : (
            <div className="max-h-64 overflow-auto">
              {items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors"
                  onClick={() => selectItem(it)}
                >
                  <div className="text-sm font-medium text-foreground">{it.label}</div>
                  {it.meta ? <div className="text-xs text-muted-foreground">{it.meta}</div> : null}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

