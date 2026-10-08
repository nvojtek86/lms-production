"use client";
import {useUi} from "@/i18n/useUi";


import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Clock, Download, Building2, User, ShieldCheck, FileText, X } from "lucide-react";

import { HelpText } from "@/components/table-v2/controls";
import { useBodyScrollLock, useEscClose, useMountedForAnimation } from "@/components/table-v2/hooks";
import LocalDateTime from "@/components/ui/LocalDateTime";
import { asRecord, getMetaBoolean, getMetaNumber, getMetaString } from "@/lib/audit/exportHelpers";

export type RecentExportItemV2 = {
  id: string;
  time: string;
  timeIso?: string | null;
  what: string;
  who: string;
  organization?: string | null;
  scope?: string | null; // e.g. "system" / "organizations"
  scopeId?: string | null;
  meta?: unknown;
};

function PrettyJson({ value }: { value: unknown }) {
  const text = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);

  return (
    <pre className="mt-2 max-h-[320px] overflow-auto rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground whitespace-pre-wrap wrap-break-word">
      {text}
    </pre>
  );
}

export function RecentExportsTableV2({
  items,
  emptyTitle = "No export history yet.",
  emptySubtitle = "Exports are logged when you download a CSV above.",
  tip = "Tip: click any row to open details.",
}: {
  items: RecentExportItemV2[];
  emptyTitle?: string;
  emptySubtitle?: string;
  tip?: string;
}) {
  const ui = useUi();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerMounted = useMountedForAnimation(drawerOpen, 220);

  useEscClose(drawerOpen, () => setDrawerOpen(false));
  useBodyScrollLock(drawerOpen);

  const active = useMemo(() => (activeId ? items.find((i) => i.id === activeId) ?? null : null), [activeId, items]);

  return (
    <div className="space-y-3">
      <HelpText>{tip}</HelpText>

      {/* Desktop table */}
      <div className="hidden lg:block rounded-md border bg-background overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="min-w-max w-full">
            <thead className="bg-background border-b">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Time")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("What")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Who")}</th>
                <th className="px-6 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-muted-foreground">
                    <div className="font-medium">{emptyTitle}</div>
                    {emptySubtitle ? <div className="text-sm mt-1">{emptySubtitle}</div> : null}
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr
                    key={it.id}
                    className="group cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => {
                      setActiveId(it.id);
                      setDrawerOpen(true);
                    }}
                  >
                    <td className="px-6 py-4 text-sm text-muted-foreground font-mono whitespace-nowrap">
                      <LocalDateTime iso={it.timeIso} fallback={it.time} />
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground">{it.what}</td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">{it.who}</td>
                    <td className="px-6 py-4 text-right">
                      <span className="sr-only">{ui("Open details")}</span>
                      <ChevronRight className="inline-block h-4 w-4 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="lg:hidden space-y-3">
        {items.length === 0 ? (
          <div className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">
            <div className="font-medium">{emptyTitle}</div>
            {emptySubtitle ? <div className="mt-1">{emptySubtitle}</div> : null}
          </div>
        ) : (
          items.map((it) => (
            <button
              key={it.id}
              type="button"
              className="w-full text-left rounded-lg border bg-background p-4 shadow-sm hover:bg-muted/20 transition-colors"
              onClick={() => {
                setActiveId(it.id);
                setDrawerOpen(true);
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">{it.what}</div>
                  <div className="mt-1 text-xs text-muted-foreground truncate">{it.who}</div>
                  <div className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="font-mono whitespace-nowrap">
                      <LocalDateTime iso={it.timeIso} fallback={it.time} />
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            </button>
          ))
        )}
      </div>

      {drawerMounted && active ? (
        <RecentExportDetailsDrawer key={active.id} open={drawerOpen} item={active} onClose={() => setDrawerOpen(false)} />
      ) : null}
    </div>
  );
}

function RecentExportDetailsDrawer({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item: RecentExportItemV2;
  onClose: () => void;
}) {
  const ui = useUi();
  const [entered, setEntered] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 0);
    return () => window.clearTimeout(t);
  }, []);

  const meta = asRecord(item.meta);
  const show = open && entered;

  const exportType = getMetaString(meta, "export");
  const format = getMetaString(meta, "format");
  const rowCount = getMetaNumber(meta, "row_count");
  const max = getMetaNumber(meta, "max");
  const orgIdMeta = getMetaString(meta, "organization_id");

  const courseId = getMetaString(meta, "course_id");
  const userId = getMetaString(meta, "user_id");
  const result = getMetaString(meta, "result");
  const from = getMetaString(meta, "from");
  const to = getMetaString(meta, "to");
  const qPresent = getMetaBoolean(meta, "q_present");
  const qLength = getMetaNumber(meta, "q_length");

  const orgLabel = item.organization ?? orgIdMeta ?? null;

  return (
    <div className="fixed inset-0 z-100000" role="dialog" aria-modal="true" onClick={onClose}>
      <div className={`absolute inset-0 z-0 bg-black/40 transition-opacity duration-200 ${show ? "opacity-100" : "opacity-0"}`} />

      <div
        className={`
          fixed right-0 top-0 bottom-0 z-10 w-full max-w-[750px] bg-background shadow-2xl border-l flex flex-col
          transition-transform duration-200 ease-out
          ${show ? "translate-x-0" : "translate-x-full"}
          lg:right-6 lg:top-[30px] lg:bottom-6 lg:border lg:rounded-3xl
        `}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-16 px-6 flex items-center justify-between">
          <div className="text-md font-semibold text-foreground bg-muted-foreground/10 rounded-md px-6 py-2">{ui("Export Details")}</div>
          <button
            type="button"
            aria-label={ui("Close")}
            className="inline-flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b" />

        <div className="flex-1 overflow-auto px-6 py-6 space-y-6">
          {/* Summary */}
          <div className="rounded-xl bg-muted/30 border p-5">
            <div className="text-lg font-semibold text-primary">{item.what}</div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-start justify-between gap-4">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {ui("Time")}</span>
                <span className="text-foreground text-right">
                  <LocalDateTime iso={item.timeIso} fallback={item.time} />
                </span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <User className="h-4 w-4" />
                  {ui("Who")}</span>
                <span className="text-foreground text-right break-all">{item.who}</span>
              </div>
              {orgLabel ? (
                <div className="flex items-start justify-between gap-4">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                    {ui("Organization")}</span>
                  <span className="text-foreground text-right">{orgLabel}</span>
                </div>
              ) : null}
              {item.scope ? (
                <div className="flex items-start justify-between gap-4">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <ShieldCheck className="h-4 w-4" />
                    {ui("Scope")}</span>
                  <span className="text-foreground text-right">
                    {item.scope}
                    {item.scopeId ? ` (${item.scopeId})` : ""}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Details */}
          <div className="space-y-3">
            <div className="text-xl font-semibold text-foreground">{ui("Details")}</div>
            <div className="rounded-xl border bg-background p-5 space-y-3 text-sm">
              {exportType ? (
                <div className="flex items-start justify-between gap-4">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Download className="h-4 w-4" />
                    {ui("Export")}</span>
                  <span className="text-foreground text-right">{exportType}</span>
                </div>
              ) : null}
              {format ? (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">{ui("Format")}</span>
                  <span className="text-foreground text-right">{format}</span>
                </div>
              ) : null}
              {typeof rowCount === "number" ? (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">{ui("Row count")}</span>
                  <span className="text-foreground text-right tabular-nums">{rowCount}</span>
                </div>
              ) : null}
              {typeof max === "number" ? (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">{ui("Max")}</span>
                  <span className="text-foreground text-right tabular-nums">{max}</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Filters (optional) */}
          {courseId || userId || result || from || to || qPresent !== null ? (
            <div className="space-y-3">
              <div className="text-xl font-semibold text-foreground">{ui("Filters")}</div>
              <div className="rounded-xl border bg-background p-5 space-y-3 text-sm">
                {courseId ? (
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-muted-foreground">{ui("Course")}</span>
                    <span className="text-foreground text-right break-all">{courseId}</span>
                  </div>
                ) : null}
                {userId ? (
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-muted-foreground">{ui("User")}</span>
                    <span className="text-foreground text-right break-all">{userId}</span>
                  </div>
                ) : null}
                {result ? (
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-muted-foreground">{ui("Result")}</span>
                    <span className="text-foreground text-right">{result}</span>
                  </div>
                ) : null}
                {from ? (
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-muted-foreground">{ui("From")}</span>
                    <span className="text-foreground text-right break-all">{from}</span>
                  </div>
                ) : null}
                {to ? (
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-muted-foreground">{ui("To")}</span>
                    <span className="text-foreground text-right break-all">{to}</span>
                  </div>
                ) : null}
                {qPresent !== null ? (
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-muted-foreground">{ui("Search")}</span>
                    <span className="text-foreground text-right">
                      {qPresent ? ui("Yes{v0}", {v0: typeof qLength === "number" ? ` (${qLength})` : ""}) : ui("No")}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Raw metadata */}
          {item.meta ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xl font-semibold text-foreground">{ui("Raw metadata")}</div>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/30 transition-colors"
                  onClick={() => setShowMeta((v) => !v)}
                >
                  <FileText className="h-4 w-4" />
                  {showMeta ? ui("Hide") : ui("Show")}
                </button>
              </div>
              {showMeta ? <PrettyJson value={item.meta} /> : null}
              <HelpText>{ui("Shows the audit log metadata captured when the export was generated.")}</HelpText>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

