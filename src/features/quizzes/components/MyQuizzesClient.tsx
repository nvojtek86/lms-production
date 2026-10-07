"use client";
import {useUi} from "@/i18n/useUi";


import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ExternalLink, FileText, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FilterSelect, HelpText } from "@/components/table-v2/controls";
import { useBodyScrollLock, useEscClose, useMountedForAnimation } from "@/components/table-v2/hooks";
import { fetchJson } from "@/lib/api";
import { cn } from "@/lib/utils";

export type MyQuizAttemptRow = {
  id: string; // attempt_id
  course_id: string;
  course_title: string;
  course_slug: string | null;
  quiz_item_id: string;
  quiz_title: string;
  attempt_number: number | null;
  graded_at: string;
  score_percent: number;
  passed: boolean;
  earned_points: number;
  total_points: number;
};

type AttemptDetails = {
  attempt: {
    id: string;
    attempt_number: number | null;
    started_at: string | null;
    submitted_at: string | null;
  };
  result: {
    graded_at: string;
    score_percent: number;
    passed: boolean;
    passing_grade_percent: number;
    earned_points: number;
    total_points: number;
    per_question: Array<{ question_id: string; correct: boolean; earned_points: number; points: number; missing: boolean }>;
  };
  quiz: {
    id: string;
    title: string;
    summary_html: string;
    questions: Array<{ id: string; title: string; type: string; description_html: string; answer_explanation_html: string }>;
    settings: { feedback_mode: "default" | "reveal" | "retry" };
  };
  course: { id: string; title: string; slug: string | null };
};

function formatTime(iso: string, locale = "en"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(locale, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function MyQuizzesClient({ orgId, rows }: { orgId: string; rows: MyQuizAttemptRow[] }) {
  const ui = useUi();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerMounted = useMountedForAnimation(drawerOpen, 220);

  useEscClose(drawerOpen, () => setDrawerOpen(false));
  useBodyScrollLock(drawerOpen);

  const [statusFilter, setStatusFilter] = useState<"all" | "passed" | "failed">("all");
  const courseOptions = useMemo(() => {
    const uniq = new Map<string, string>();
    for (const r of rows) uniq.set(r.course_id, r.course_title);
    const opts: Array<{ value: string; label: string }> = [{ value: "all", label: ui("All courses") }];
    for (const [id, title] of Array.from(uniq.entries()).sort((a, b) => a[1].localeCompare(b[1]))) {
      opts.push({ value: id, label: title });
    }
    return opts;
  }, [rows, ui]);
  const [courseFilter, setCourseFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (courseFilter !== "all" && r.course_id !== courseFilter) return false;
      if (statusFilter === "passed" && !r.passed) return false;
      if (statusFilter === "failed" && r.passed) return false;
      return true;
    });
  }, [courseFilter, rows, statusFilter]);

  const active = useMemo(() => (activeId ? filtered.find((r) => r.id === activeId) ?? null : null), [activeId, filtered]);

  const [details, setDetails] = useState<AttemptDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  useEffect(() => {
    if (!drawerOpen || !activeId) return;
    const t = window.setTimeout(() => {
      setDetails(null);
      setDetailsError(null);
      setDetailsLoading(true);
      fetchJson<AttemptDetails>(`/api/v2/quiz-attempts/${encodeURIComponent(activeId)}`, { cache: "no-store" })
        .then(({ data }) => setDetails(data as AttemptDetails))
        .catch((e) => setDetailsError(e instanceof Error ? e.message : "Failed to load attempt."))
        .finally(() => setDetailsLoading(false));
    }, 0);
    return () => window.clearTimeout(t);
  }, [activeId, drawerOpen]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="text-lg font-semibold text-foreground">{ui("Attempt history")}</div>
          <HelpText>{ui("Tip: click any row to open attempt details.")}</HelpText>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <FilterSelect
            ariaLabel="Filter by status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: ui("All statuses") },
              { value: "passed", label: ui("Passed") },
              { value: "failed", label: ui("Failed") },
            ]}
            className="min-w-[180px]"
          />
          <FilterSelect
            ariaLabel="Filter by course"
            value={courseFilter}
            onChange={setCourseFilter}
            options={courseOptions}
            className="min-w-[220px]"
          />
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden lg:block rounded-lg border overflow-hidden bg-card">
        <div className="w-full overflow-x-auto">
          <table className="min-w-max w-full">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Course")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Quiz")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Attempt")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Score")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Status")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Date")}</th>
                <th className="px-6 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-sm text-muted-foreground">
                    {ui("No quiz attempts yet.")}</td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="group cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => {
                      setActiveId(r.id);
                      setDrawerOpen(true);
                    }}
                  >
                    <td className="px-6 py-4 text-sm text-foreground">{r.course_title}</td>
                    <td className="px-6 py-4 text-sm text-foreground">{r.quiz_title}</td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {typeof r.attempt_number === "number" ? `#${r.attempt_number}` : "—"}
                    </td>
                    <td className="px-6 py-4">
                      <div className={cn("text-lg font-bold", r.passed ? "text-green-600" : "text-red-600")}>
                        {r.score_percent}%
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.earned_points}/{r.total_points} {ui("pts")}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={cn(
                          "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
                          r.passed ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                        )}
                      >
                        {r.passed ? ui("Passed") : ui("Failed")}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">{formatTime(r.graded_at, ui.locale)}</td>
                    <td className="px-6 py-4 text-right">
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
        {filtered.length === 0 ? (
          <div className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">{ui("No quiz attempts yet.")}</div>
        ) : (
          filtered.map((r) => (
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
                  <div className="text-xs text-muted-foreground">{r.course_title}</div>
                  <div className="mt-2 text-sm text-foreground font-semibold truncate">{r.quiz_title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {ui("Attempt ")}{typeof r.attempt_number === "number" ? `#${r.attempt_number}` : "—"} • {formatTime(r.graded_at, ui.locale)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={cn("text-lg font-bold", r.passed ? "text-green-600" : "text-red-600")}>{r.score_percent}%</div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.earned_points}/{r.total_points} {ui("pts")}</div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Drawer */}
      {drawerMounted && active ? (
        <QuizAttemptDetailsDrawer
          key={active.id}
          open={drawerOpen}
          active={active}
          details={details}
          loading={detailsLoading}
          error={detailsError}
          orgId={orgId}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}
    </div>
  );
}

function QuizAttemptDetailsDrawer({
  open,
  active,
  details,
  loading,
  error,
  orgId,
  onClose,
}: {
  open: boolean;
  active: MyQuizAttemptRow;
  details: AttemptDetails | null;
  loading: boolean;
  error: string | null;
  orgId: string;
  onClose: () => void;
}) {
  const ui = useUi();
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 0);
    return () => window.clearTimeout(t);
  }, []);

  const show = open && entered;

  const courseHref = active.course_slug ? `/org/${orgId}/courses/${active.course_slug}` : `/org/${orgId}/courses/${active.course_id}`;

  const questionMeta = useMemo(() => {
    const per = details?.result?.per_question ?? [];
    const map = new Map(per.map((x) => [x.question_id, x]));
    return map;
  }, [details?.result?.per_question]);

  return (
    <div className="fixed inset-0 z-100000" role="dialog" aria-modal="true" onClick={onClose}>
      <div className={`absolute inset-0 z-0 bg-black/40 transition-opacity duration-200 ${show ? "opacity-100" : "opacity-0"}`} />

      <div
        className={`
          fixed right-0 top-0 bottom-0 z-10 w-full max-w-[820px] bg-background shadow-2xl border-l flex flex-col
          transition-transform duration-200 ease-out
          ${show ? "translate-x-0" : "translate-x-full"}
          lg:right-6 lg:top-[30px] lg:bottom-6 lg:border lg:rounded-3xl
        `}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-16 px-6 flex items-center justify-between">
          <div className="text-md font-semibold text-foreground bg-muted-foreground/10 rounded-md px-6 py-2">{ui("Quiz Attempt")}</div>
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
          {/* Summary card */}
          <div className={cn("rounded-2xl border p-5", active.passed ? "bg-emerald-50" : "bg-amber-50")}>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">{active.course_title}</div>
                <div className="text-xl font-semibold text-foreground">{active.quiz_title}</div>
                <div className="text-sm text-muted-foreground">
                  {ui("Attempt ")}{typeof active.attempt_number === "number" ? `#${active.attempt_number}` : "—"} • {formatTime(active.graded_at, ui.locale)}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className={cn("text-3xl font-bold", active.passed ? "text-green-700" : "text-amber-800")}>{active.score_percent}%</div>
                <div className="text-sm text-muted-foreground">
                  {active.earned_points}/{active.total_points} {ui("pts")}</div>
                {typeof details?.result?.passing_grade_percent === "number" ? (
                  <div className="text-xs text-muted-foreground">{ui("Passing: ")}{details.result.passing_grade_percent}%</div>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <span
                className={cn(
                  "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold",
                  active.passed ? "bg-emerald-100 text-emerald-800" : "bg-amber-200/60 text-amber-900"
                )}
              >
                {active.passed ? ui("Passed") : ui("Failed")}
              </span>
              <Button variant="outline" asChild className="gap-2">
                <a href={courseHref} target="_blank" rel="noreferrer">
                  {ui("Open course ")}<ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="rounded-xl border bg-muted/10 p-5 text-sm text-muted-foreground">{ui("Loading attempt details…")}</div>
          ) : error ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">{ui(error)}</div>
          ) : details ? (
            <>
              {details.quiz.summary_html?.trim() ? (
                <div className="rounded-2xl border bg-card p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <FileText className="h-4 w-4 text-primary" />
                    {ui("Quiz summary")}</div>
                  <div className="mt-3 prose prose-base max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: details.quiz.summary_html }} />
                </div>
              ) : null}

              <div className="space-y-4">
                {details.quiz.questions.map((q, idx) => {
                  const r = questionMeta.get(q.id) ?? null;
                  const isCorrect = Boolean(r?.correct);
                  return (
                    <div key={q.id} className="rounded-2xl border bg-card p-5 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-semibold text-foreground">
                          Q{idx + 1} • {(q.title ?? "").trim() || ui("Question")}
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                            isCorrect ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                          )}
                        >
                          {isCorrect ? ui("Correct answer") : ui("Incorrect answer")}
                        </span>
                      </div>
                      {q.description_html?.trim() ? (
                        <div className="prose prose-base max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: q.description_html }} />
                      ) : null}

                      {details.quiz.settings.feedback_mode === "reveal" && q.answer_explanation_html?.trim() ? (
                        <div className="rounded-xl border bg-muted/10 p-4">
                          <div className="text-sm font-semibold text-foreground">{ui("Explanation")}</div>
                          <div className="mt-2 prose prose-base max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: q.answer_explanation_html }} />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="rounded-xl border bg-muted/10 p-5 text-sm text-muted-foreground">{ui("No details found.")}</div>
          )}
        </div>
      </div>
    </div>
  );
}

