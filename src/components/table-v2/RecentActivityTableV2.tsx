"use client";
import {useUi} from "@/i18n/useUi";


import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Clock, FileText, User, X } from "lucide-react";

import { Button } from "@/components/core/button";
import { HelpText } from "@/components/table-v2/controls";
import { useBodyScrollLock, useEscClose, useMountedForAnimation } from "@/components/table-v2/hooks";
import LocalDateTime from "@/components/ui/LocalDateTime";

export type RecentActivityItemV2 = {
  id: string;
  time: string;
  timeIso?: string | null;
  actor: string;
  subject: string;
  title: string; // action/event name
  details?: string | null;
  meta?: unknown;
};

export function RecentActivityTableV2({
  items,
  emptyTitle = "No recent activity yet.",
  emptySubtitle,
  tip = "Tip: click any row to open details.",
}: {
  items: RecentActivityItemV2[];
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
      <div className="hidden lg:block rounded-lg border overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="min-w-max w-full">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">{ui("Time")}</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">{ui("Actor")}</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">{ui("Subject")}</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {emptyTitle}
                    {emptySubtitle ? <div className="text-xs mt-2">{emptySubtitle}</div> : null}
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr
                    key={row.id}
                    className="group cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => {
                      setActiveId(row.id);
                      setDrawerOpen(true);
                    }}
                  >
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono whitespace-nowrap">
                      <LocalDateTime iso={row.timeIso} fallback={row.time} />
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{row.actor}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{row.subject}</td>
                    <td className="px-4 py-3 text-right">
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
            <div>{emptyTitle}</div>
            {emptySubtitle ? <div className="text-xs mt-2">{emptySubtitle}</div> : null}
          </div>
        ) : (
          items.map((row) => (
            <button
              key={row.id}
              type="button"
              className="w-full text-left rounded-lg border bg-background p-4 shadow-sm hover:bg-muted/20 transition-colors"
              onClick={() => {
                setActiveId(row.id);
                setDrawerOpen(true);
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground font-mono">
                    <LocalDateTime iso={row.timeIso} fallback={row.time} />
                  </div>
                  <div className="mt-2 text-sm text-foreground font-medium truncate">{row.subject}</div>
                  <div className="mt-1 text-xs text-muted-foreground truncate">{row.actor}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            </button>
          ))
        )}
      </div>

      {/* Drawer */}
      {drawerMounted && active ? (
        <RecentActivityDetailsDrawer key={active.id} open={drawerOpen} item={active} onClose={() => setDrawerOpen(false)} />
      ) : null}
    </div>
  );
}

function RecentActivityDetailsDrawer({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item: RecentActivityItemV2;
  onClose: () => void;
}) {
  const ui = useUi();
  const [entered, setEntered] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 0);
    return () => window.clearTimeout(t);
  }, []);

  const show = open && entered;

  const metaText = useMemo(() => {
    if (item.meta === undefined) return null;
    try {
      return JSON.stringify(item.meta, null, 2);
    } catch {
      return String(item.meta);
    }
  }, [item.meta]);

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
          <div className="text-md font-semibold text-foreground bg-muted-foreground/10 rounded-md px-6 py-2">{ui("Activity Details")}</div>
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
            <h2 className="text-lg font-semibold text-foreground">{ui("What happened?")}</h2>
            <div className="text-lg font-semibold text-primary">{item.title || ui("Activity")} {ui("by ")}<span className="font-bold text-foreground">{item.actor}</span></div>
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
                  {ui("Actor")}</span>
                <span className="text-foreground text-right break-all">{item.actor}</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  {ui("Subject")}</span>
                <span className="text-foreground text-right wrap-break-word">{item.subject}</span>
              </div>
            </div>
          </div>

          {/* Details */}
          {item.details && item.details.trim().length > 0 ? (
            <div className="space-y-3">
              <div className="text-xl font-semibold text-foreground">{ui("Details")}</div>
              <div className="rounded-xl border bg-background p-5 text-sm text-muted-foreground whitespace-pre-wrap">
                {item.details}
              </div>
            </div>
          ) : null}

          {/* Metadata */}
          {metaText ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xl font-semibold text-foreground">{ui("Metadata")}</div>
                <Button variant="outline" size="sm" onClick={() => setShowMeta((v) => !v)}>
                  {showMeta ? ui("Hide") : ui("Show")}
                </Button>
              </div>
              {showMeta ? (
                <pre className="rounded-xl border bg-background p-5 text-xs text-muted-foreground overflow-auto">
{metaText}
                </pre>
              ) : (
                <HelpText>{ui("Metadata is available for troubleshooting.")}</HelpText>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

