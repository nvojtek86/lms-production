"use client";
import {useUi} from "@/i18n/useUi";


import { useEffect, useMemo, useState } from "react";
import { Award, CalendarDays, ChevronRight, Download, User, BookOpen, Building2, X } from "lucide-react";

import { Button } from "@/components/core/button";
import { HelpText } from "@/components/table-v2/controls";
import { useBodyScrollLock, useEscClose, useMountedForAnimation } from "@/components/table-v2/hooks";

export type CertificateRowV2 = {
  id: string;
  userLabel: string;
  courseLabel: string;
  issuedLabel: string;
  statusLabel: string;
  expiresLabel?: string | null;
  organizationLabel?: string | null;
  canDownload: boolean;
  downloadHref: string | null;
  meta?: unknown;
};

function StatusPill({ status, className }: { status: string; className?: string }) {
  const ui = useUi();
  const s = (status || "—").trim();
  const ok = s.toLowerCase() === "valid";
  const cls = ok ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${cls} ${className ?? ""}`}>
      {ui(s || "—")}
    </span>
  );
}

export function CertificatesTableV2({
  title = "Certificates",
  subtitle,
  rows,
  tip = "Tip: click any row to open certificate details.",
}: {
  title?: string;
  subtitle?: string;
  rows: CertificateRowV2[];
  tip?: string;
}) {
  const ui = useUi();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerMounted = useMountedForAnimation(drawerOpen, 220);

  useEscClose(drawerOpen, () => setDrawerOpen(false));
  useBodyScrollLock(drawerOpen);

  const active = useMemo(() => (activeId ? rows.find((r) => r.id === activeId) ?? null : null), [activeId, rows]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Award className="h-8 w-8 text-primary shrink-0" />
            <div>
              <h2 className="text-2xl font-bold text-foreground">{ui(title)}</h2>
              {subtitle ? <p className="text-muted-foreground">{ui(subtitle)}</p> : null}
            </div>
          </div>
          <HelpText className="mt-2">{ui(tip)}</HelpText>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden lg:block rounded-md border bg-background overflow-hidden shadow-sm">
        <div className="w-full overflow-x-auto">
          <table className="min-w-max w-full">
            <thead className="bg-background border-b">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("User")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Course")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Issued Date")}</th>
                <th className="px-6 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-muted-foreground">
                    {ui("No certificates found.")}</td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="group cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => {
                      setActiveId(r.id);
                      setDrawerOpen(true);
                    }}
                  >
                    <td className="px-6 py-4 font-medium text-foreground">{r.userLabel}</td>
                    <td className="px-6 py-4 text-muted-foreground">{r.courseLabel}</td>
                    <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">{r.issuedLabel}</td>
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
        {rows.length === 0 ? (
          <div className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">{ui("No certificates found.")}</div>
        ) : (
          rows.map((r) => (
            <button
              key={r.id}
              type="button"
              className="w-full text-left rounded-lg border bg-background p-4 shadow-sm hover:bg-muted/20 transition-colors"
              onClick={() => {
                setActiveId(r.id);
                setDrawerOpen(true);
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">{r.courseLabel}</div>
                  <div className="mt-1 text-xs text-muted-foreground truncate">{r.userLabel}</div>
                  <div className="mt-2 text-xs text-muted-foreground font-mono whitespace-nowrap">{r.issuedLabel}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            </button>
          ))
        )}
      </div>

      {/* Drawer */}
      {drawerMounted && active ? (
        <CertificateDetailsDrawer key={active.id} open={drawerOpen} row={active} onClose={() => setDrawerOpen(false)} />
      ) : null}
    </div>
  );
}

function CertificateDetailsDrawer({
  open,
  row,
  onClose,
}: {
  open: boolean;
  row: CertificateRowV2;
  onClose: () => void;
}) {
  const ui = useUi();
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 0);
    return () => window.clearTimeout(t);
  }, []);

  const show = open && entered;

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
        {/* Header */}
        <div className="h-16 px-6 flex items-center justify-between">
          <div className="text-md font-semibold text-foreground bg-muted-foreground/10 rounded-md px-6 py-2">{ui("Certificate Details")}</div>
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
            <div className="text-lg font-semibold text-primary">{row.courseLabel}</div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-start justify-between gap-4">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <User className="h-4 w-4" />
                  {ui("User")}</span>
                <span className="text-foreground text-right break-all">{row.userLabel}</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <BookOpen className="h-4 w-4" />
                  {ui("Course")}</span>
                <span className="text-foreground text-right wrap-break-word">{row.courseLabel}</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <CalendarDays className="h-4 w-4" />
                  {ui("Issued")}</span>
                <span className="text-foreground text-right">{row.issuedLabel}</span>
              </div>
            </div>
          </div>

          {/* Additional info */}
          <div className="space-y-3">
            <div className="text-xl font-semibold text-foreground">{ui("Info")}</div>
            <div className="rounded-xl border bg-background p-5 space-y-3 text-sm">
              {row.organizationLabel ? (
                <div className="flex items-start justify-between gap-4">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                    {ui("Organization")}</span>
                  <span className="text-foreground text-right">{row.organizationLabel}</span>
                </div>
              ) : null}

              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">{ui("Status")}</span>
                <StatusPill status={row.statusLabel} />
              </div>

              {row.expiresLabel ? (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">{ui("Expires")}</span>
                  <span className="text-foreground text-right">{row.expiresLabel}</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-3">
            <div className="text-xl font-semibold text-foreground">{ui("Actions")}</div>
            <div className="rounded-xl border bg-background p-5">
              {row.canDownload && row.downloadHref ? (
                <Button asChild variant="outline">
                  <a href={row.downloadHref} target="_blank" rel="noreferrer">
                    <Download className="h-4 w-4" />
                    {ui("Download")}</a>
                </Button>
              ) : (
                <div className="text-sm text-muted-foreground">{ui("Download not available.")}</div>
              )}
              <HelpText className="mt-2">{ui("Downloads the certificate template for this course.")}</HelpText>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

