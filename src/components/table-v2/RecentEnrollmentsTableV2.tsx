"use client";
import {useUi} from "@/i18n/useUi";


import { useEffect, useMemo, useState } from "react";
import { BookOpen, CalendarDays, ChevronRight, Clock, Building2, User, X, BadgeCheck, BadgeX } from "lucide-react";

import { HelpText } from "@/components/table-v2/controls";
import { useBodyScrollLock, useEscClose, useMountedForAnimation } from "@/components/table-v2/hooks";
import LocalDateTime from "@/components/ui/LocalDateTime";

export type EnrollmentResultV2 = "certified" | "not_certified" | null;

export type RecentEnrollmentItemV2 = {
  id: string;
  time: string; // already formatted for display (e.g. toLocaleString on server)
  timeIso?: string | null;
  organization?: string | null;
  user: string;
  course: string;

  result: EnrollmentResultV2;
  enrollmentStatus?: string | null;
  enrolledAt?: string | null;
  certificateIssuedAt?: string | null;

  meta?: unknown;
};

function ResultPill({ result }: { result: EnrollmentResultV2 }) {
  const ui = useUi();
  const r = result ?? "not_certified";
  const label = r === "certified" ? "Certified" : "Not certified";
  const cls =
    r === "certified"
      ? "bg-green-100 text-green-800"
      : "bg-gray-100 text-gray-800";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{ui(label)}</span>;
}

export function RecentEnrollmentsTableV2({
  items,
  emptyTitle = "No enrollments yet.",
  emptySubtitle,
  tip = "Tip: click any row to open details.",
}: {
  items: RecentEnrollmentItemV2[];
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
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap">{ui("Time")}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{ui("User")}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{ui("Course")}</th>
                <th className="px-4 py-3 w-10" />
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
                    <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                      <LocalDateTime iso={it.timeIso} fallback={it.time} />
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium text-foreground">{it.user}</div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium text-foreground">{it.course}</div>
                    </td>
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
                  <div className="text-sm font-semibold text-foreground truncate">{it.course}</div>
                  <div className="mt-1 text-xs text-muted-foreground truncate">{it.user}</div>
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

      {/* Drawer */}
      {drawerMounted && active ? (
        <RecentEnrollmentDetailsDrawer
          key={active.id}
          open={drawerOpen}
          item={active}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}
    </div>
  );
}

function RecentEnrollmentDetailsDrawer({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item: RecentEnrollmentItemV2;
  onClose: () => void;
}) {
  const ui = useUi();
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 0);
    return () => window.clearTimeout(t);
  }, []);

  const show = open && entered;

  const isCertified = (item.result ?? "not_certified") === "certified";
  const ResultIcon = isCertified ? BadgeCheck : BadgeX;
  const resultLabel = isCertified ? "Certificate issued" : "No certificate yet";

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
          <div className="text-md font-semibold text-foreground bg-muted-foreground/10 rounded-md px-6 py-2">{ui("Enrollment Details")}</div>
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
            <div className="text-lg font-semibold text-primary">{item.course}</div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-start justify-between gap-4">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <User className="h-4 w-4" />
                  {ui("User")}</span>
                <span className="text-foreground text-right break-all">{item.user}</span>
              </div>

              {item.organization ? (
                <div className="flex items-start justify-between gap-4">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                    {ui("Organization")}</span>
                  <span className="text-foreground text-right">{item.organization}</span>
                </div>
              ) : null}

              <div className="flex items-start justify-between gap-4">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <BookOpen className="h-4 w-4" />
                  {ui("Course")}</span>
                <span className="text-foreground text-right wrap-break-word">{item.course}</span>
              </div>

              <div className="flex items-start justify-between gap-4">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <CalendarDays className="h-4 w-4" />
                  {ui("Time")}</span>
                <span className="text-foreground text-right">
                  <LocalDateTime iso={item.timeIso} fallback={item.time} />
                </span>
              </div>

              <div className="flex items-start justify-between gap-4">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <ResultIcon className="h-4 w-4" />
                  {ui("Certificate")}</span>
                <div className="text-right space-y-1">
                  <ResultPill result={item.result} />
                  <div className="text-xs text-muted-foreground">{resultLabel}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Info */}
          <div className="space-y-3">
            <div className="text-xl font-semibold text-foreground">{ui("Info")}</div>
            <div className="rounded-xl border bg-background p-5 space-y-3 text-sm">
              {item.enrollmentStatus ? (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">{ui("Enrollment status")}</span>
                  <span className="text-foreground text-right">{item.enrollmentStatus}</span>
                </div>
              ) : null}

              {item.enrolledAt ? (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">{ui("Enrolled")}</span>
                  <span className="text-foreground text-right">
                    <LocalDateTime iso={item.enrolledAt} />
                  </span>
                </div>
              ) : null}

              {item.certificateIssuedAt ? (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">{ui("Certificate issued")}</span>
                  <span className="text-foreground text-right">
                    <LocalDateTime iso={item.certificateIssuedAt} />
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

