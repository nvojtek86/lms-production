"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Lock,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/api";
import { ApiClientError } from "@/lib/api/fetchJson";

export type LearnV2LessonVideo =
  | { kind: "html5"; url: string; mime: string }
  | { kind: "embed"; url: string };

export type LearnV2Item = {
  id: string;
  item_type: "lesson" | "quiz";
  title: string;
  position: number;
  lesson?: {
    content_html: string;
    content_blocks?: string[];
    feature_image_url: string | null;
    video: LearnV2LessonVideo | null;
    attachments: Array<{ file_name: string; url: string; size_bytes: number | null; mime: string | null }>;
    duration_minutes?: number | null;
  };
  quiz?: {
    kind: string | null;
    summary_html: string;
    questions: Array<{
      id: string;
      title: string;
      type: string;
      answer_required: boolean;
      randomize: boolean;
      points: number;
      display_points: boolean;
      description_html: string;
      answer_explanation_html: string;
      options: Array<{
        id: string;
        title: string;
        image_data_url: string | null;
        display_format: string;
        position: number;
      }>;
    }>;
    settings: {
      time_limit_value: number;
      time_limit_unit: "seconds" | "minutes" | "hours";
      hide_quiz_time_display: boolean;
      feedback_mode: "default" | "reveal" | "retry";
      attempts_allowed: number; // 0 = unlimited
      passing_grade_percent: number;
      max_questions_allowed_to_answer: number;
    };
  };
};

export type LearnV2Topic = {
  id: string;
  title: string;
  position: number;
  items: LearnV2Item[];
};

type OrderedLearnItem = { topic: LearnV2Topic; item: LearnV2Item; index: number };

function quizApiBase(courseId: string, itemId: string) {
  return `/api/v2/courses/${encodeURIComponent(courseId)}/quizzes/${encodeURIComponent(itemId)}`;
}

function hostMatches(hostname: string, baseDomain: string): boolean {
  return hostname === baseDomain || hostname.endsWith(`.${baseDomain}`);
}

function toYouTubeEmbedUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    let videoId: string | null = null;

    if (hostMatches(host, "youtu.be")) {
      videoId = u.pathname.replace(/^\/+/, "").split("/")[0] || null;
    } else if (hostMatches(host, "youtube.com")) {
      if (u.pathname.startsWith("/watch")) videoId = u.searchParams.get("v");
      else if (u.pathname.startsWith("/embed/")) videoId = u.pathname.split("/")[2] || null;
      else if (u.pathname.startsWith("/shorts/")) videoId = u.pathname.split("/")[2] || null;
    }

    if (!videoId) return null;
    return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
  } catch {
    return null;
  }
}

function toVimeoEmbedUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (!hostMatches(host, "vimeo.com")) return null;

    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    const id = /^\d+$/.test(last) ? last : null;
    if (!id) return null;
    return `https://player.vimeo.com/video/${encodeURIComponent(id)}`;
  } catch {
    return null;
  }
}

function embedFromProviderUrl(url: string): string | null {
  const yt = toYouTubeEmbedUrl(url);
  if (yt) return yt;
  const vm = toVimeoEmbedUrl(url);
  if (vm) return vm;
  return null;
}

function formatBytes(n: number | null) {
  if (!Number.isFinite(Number(n)) || (n as number) <= 0) return "—";
  const v0 = Number(n);
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = v0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDurationPill(minutes: number | null | undefined): string | null {
  if (!Number.isFinite(Number(minutes)) || Number(minutes) <= 0) return null;
  const m = Math.floor(Number(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h} hr ${mm} min` : `${h} hr`;
}

function AttachmentsCard({
  attachments,
  compact,
}: {
  attachments: NonNullable<LearnV2Item["lesson"]>["attachments"];
  compact?: boolean;
}) {
  if (!attachments.length) return null;
  return (
    <div className={cn("rounded-2xl border bg-card", compact ? "" : "")}>
      <div className="px-5 py-4 border-b">
        <div className="text-base font-semibold text-foreground">Attachments</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Download lesson files and resources.
        </div>
      </div>
      <div className="p-4 space-y-2">
        {attachments.map((a, i) => (
          <a
            key={`${a.url}-${i}`}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2 hover:bg-muted/10 transition-colors cursor-pointer"
          >
            <div className="min-w-0 flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{a.file_name}</div>
                <div className="text-[11px] text-muted-foreground">{formatBytes(a.size_bytes)}</div>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 text-xs text-primary shrink-0">
              <Download className="h-4 w-4" />
              Download <ExternalLink className="h-3.5 w-3.5" />
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

export function CourseLearnV2Client({
  courseTitle,
  topics,
  courseId,
  initialSelectedItemId,
  initialVisitedItemIds,
  initialQuizStateByItemId,
}: {
  orgId: string;
  courseId: string;
  courseTitle: string;
  topics: LearnV2Topic[];
  initialSelectedItemId?: string | null;
  initialVisitedItemIds?: string[];
  initialQuizStateByItemId?: Record<
    string,
    { best_score_percent: number | null; passed_at: string | null; last_submitted_attempt_id: string | null }
  >;
}) {
  const topicsSorted = useMemo(() => topics.slice().sort((a, b) => a.position - b.position), [topics]);

  const orderedItems = useMemo(() => {
    const out: OrderedLearnItem[] = [];
    for (const t of topicsSorted) {
      const itemsSorted = (t.items ?? []).slice().sort((a, b) => a.position - b.position);
      for (const it of itemsSorted) {
        out.push({ topic: t, item: it, index: out.length });
      }
    }
    return out;
  }, [topicsSorted]);

  const firstItemId = useMemo(() => {
    const first = orderedItems[0];
    if (first?.item?.id) return first.item.id;
    return null;
  }, [orderedItems]);

  const orderedItemIdSet = useMemo(() => new Set(orderedItems.map((x) => x.item.id)), [orderedItems]);
  const resolvedInitialSelectedId = useMemo(() => {
    const cand = typeof initialSelectedItemId === "string" && initialSelectedItemId.trim().length ? initialSelectedItemId.trim() : null;
    if (cand && orderedItemIdSet.has(cand)) return cand;
    return firstItemId;
  }, [firstItemId, initialSelectedItemId, orderedItemIdSet]);

  const resolvedInitialTopicId = useMemo(() => {
    if (!resolvedInitialSelectedId) return null;
    for (const t of topicsSorted) {
      for (const it of t.items ?? []) {
        if (it.id === resolvedInitialSelectedId) return t.id;
      }
    }
    return topicsSorted[0]?.id ?? null;
  }, [resolvedInitialSelectedId, topicsSorted]);

  const resolvedInitialVisited = useMemo(() => {
    const s = new Set<string>((Array.isArray(initialVisitedItemIds) ? initialVisitedItemIds : []).filter((v) => typeof v === "string"));
    if (resolvedInitialSelectedId) s.add(resolvedInitialSelectedId);
    if (firstItemId) s.add(firstItemId);
    return s;
  }, [firstItemId, initialVisitedItemIds, resolvedInitialSelectedId]);

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    return resolvedInitialTopicId ? new Set([resolvedInitialTopicId]) : new Set();
  });
  const [selectedItemId, setSelectedItemId] = useState<string | null>(resolvedInitialSelectedId);
  const [visitedItemIds, setVisitedItemIds] = useState<Set<string>>(() => resolvedInitialVisited);

  const [quizStateByItemId, setQuizStateByItemId] = useState<
    Record<string, { best_score_percent: number | null; passed_at: string | null; last_submitted_attempt_id: string | null }>
  >(() => {
    return (initialQuizStateByItemId && typeof initialQuizStateByItemId === "object" ? initialQuizStateByItemId : {}) as Record<
      string,
      { best_score_percent: number | null; passed_at: string | null; last_submitted_attempt_id: string | null }
    >;
  });

  type QuizAttempt = {
    id: string;
    attempt_number: number;
    status: string;
    started_at: string;
    submitted_at: string | null;
    answers_json: Record<string, unknown>;
  };

  type QuizAttemptState = {
    attempts_allowed: number;
    submitted_attempts_count: number;
    attempt: QuizAttempt | null;
    state: {
      best_score_percent: number | null;
      passed_at: string | null;
      last_attempt_id: string | null;
      last_submitted_attempt_id: string | null;
    } | null;
  };

  type QuizSubmitResult = {
    attempt_id: string;
    score_percent: number;
    passed: boolean;
    passing_grade_percent: number;
    earned_points: number;
    total_points: number;
    per_question: Array<{
      question_id: string;
      correct: boolean;
      earned_points: number;
      points: number;
      missing: boolean;
      correct_answer:
        | { kind: "boolean"; value: boolean }
        | { kind: "options"; option_ids: string[] };
      selected_answer:
        | { kind: "none" }
        | { kind: "boolean"; value: boolean }
        | { kind: "options"; option_ids: string[] };
    }>;
    state: { best_score_percent: number | null; passed_at: string | null; last_submitted_attempt_id: string | null };
  };

  const [quizMetaLoading, setQuizMetaLoading] = useState(false);
  const [quizMetaError, setQuizMetaError] = useState<string | null>(null);
  const [quizAttemptsAllowed, setQuizAttemptsAllowed] = useState<number | null>(null);
  const [quizSubmittedCount, setQuizSubmittedCount] = useState<number>(0);
  const [quizAttempt, setQuizAttempt] = useState<QuizAttempt | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, unknown>>({});
  const [quizSubmitting, setQuizSubmitting] = useState(false);
  const [quizSubmitResult, setQuizSubmitResult] = useState<QuizSubmitResult | null>(null);
  const [retakeConfirmOpen, setRetakeConfirmOpen] = useState(false);

  const autosaveRef = useRef<{ timer: number | null; attemptId: string | null; courseId: string | null; itemId: string | null; answers: Record<string, unknown> | null }>(
    { timer: null, attemptId: null, courseId: null, itemId: null, answers: null }
  );

  async function loadQuizAttemptState(courseId: string, itemId: string) {
    setQuizMetaLoading(true);
    setQuizMetaError(null);
    try {
      const res = await fetchJson<QuizAttemptState>(`${quizApiBase(courseId, itemId)}/attempt`, { cache: "no-store" });
      const body = res?.data as QuizAttemptState;
      setQuizAttemptsAllowed(typeof body.attempts_allowed === "number" ? body.attempts_allowed : null);
      setQuizSubmittedCount(typeof body.submitted_attempts_count === "number" ? body.submitted_attempts_count : 0);
      setQuizAttempt(body.attempt && body.attempt.id ? body.attempt : null);
      setQuizAnswers((body.attempt?.answers_json ?? {}) as Record<string, unknown>);

      if (body.state && itemId) {
        setQuizStateByItemId((prev) => ({
          ...prev,
          [itemId]: {
            best_score_percent: typeof body.state!.best_score_percent === "number" ? body.state!.best_score_percent : null,
            passed_at: typeof body.state!.passed_at === "string" ? body.state!.passed_at : null,
            last_submitted_attempt_id: typeof body.state!.last_submitted_attempt_id === "string" ? body.state!.last_submitted_attempt_id : null,
          },
        }));
      }
    } catch (e) {
      setQuizMetaError(e instanceof Error ? e.message : "Failed to load quiz attempt.");
      setQuizAttempt(null);
      setQuizAnswers({});
    } finally {
      setQuizMetaLoading(false);
    }
  }

  async function startQuizAttempt(courseId: string, itemId: string) {
    setQuizMetaError(null);
    try {
      const { data } = await fetchJson<{ attempt: QuizAttempt }>(`${quizApiBase(courseId, itemId)}/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const attempt = (data as { attempt?: QuizAttempt }).attempt ?? null;
      if (attempt?.id) {
        setQuizAttempt(attempt);
        setQuizAnswers((attempt.answers_json ?? {}) as Record<string, unknown>);
        setQuizSubmitResult(null);
        void loadQuizAttemptState(courseId, itemId);
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "CONFLICT") {
        setQuizMetaError("You’ve reached the maximum number of attempts for this quiz.");
        return;
      }
      setQuizMetaError(e instanceof Error ? e.message : "Failed to start quiz.");
    }
  }

  async function retakeQuizAttempt(courseId: string, itemId: string) {
    setQuizMetaError(null);
    try {
      const { data } = await fetchJson<{ attempt: QuizAttempt }>(`${quizApiBase(courseId, itemId)}/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retake" }),
      });
      const attempt = (data as { attempt?: QuizAttempt }).attempt ?? null;
      if (attempt?.id) {
        setQuizAttempt(attempt);
        setQuizAnswers((attempt.answers_json ?? {}) as Record<string, unknown>);
        setQuizSubmitResult(null);
        void loadQuizAttemptState(courseId, itemId);
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "CONFLICT") {
        setQuizMetaError("You’ve reached the maximum number of attempts for this quiz.");
        return;
      }
      setQuizMetaError(e instanceof Error ? e.message : "Failed to retake quiz.");
    }
  }

  function scheduleQuizAutosave(courseId: string, itemId: string, attemptId: string, answers: Record<string, unknown>) {
    autosaveRef.current.courseId = courseId;
    autosaveRef.current.itemId = itemId;
    autosaveRef.current.attemptId = attemptId;
    autosaveRef.current.answers = answers;
    if (autosaveRef.current.timer) window.clearTimeout(autosaveRef.current.timer);
    autosaveRef.current.timer = window.setTimeout(async () => {
      autosaveRef.current.timer = null;
      try {
        if (!quizAttempt || quizAttempt.id !== attemptId) return;
        await fetchJson(`${quizApiBase(courseId, itemId)}/attempt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "autosave", answers_json: autosaveRef.current.answers ?? {} }),
        });
      } catch {
        // best-effort
      }
    }, 650);
  }

  const flushQuizAutosave = useCallback((courseId: string, itemId: string, answers: Record<string, unknown>) => {
    if (!courseId || !itemId) return;
    try {
      if (autosaveRef.current.timer) window.clearTimeout(autosaveRef.current.timer);
    } catch {
      // ignore
    }
    autosaveRef.current.timer = null;
    const url = `${quizApiBase(courseId, itemId)}/attempt`;
    const payload = JSON.stringify({ action: "autosave", answers_json: answers ?? {} });
    try {
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon && navigator.sendBeacon(url, blob)) return;
    } catch {
      // ignore
    }
    try {
      void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true });
    } catch {
      // ignore
    }
  }, []);

  async function submitQuiz(courseId: string, itemId: string, answers: Record<string, unknown>) {
    setQuizSubmitting(true);
    setQuizMetaError(null);
    try {
      const { data } = await fetchJson<QuizSubmitResult>(`${quizApiBase(courseId, itemId)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers_json: answers ?? {} }),
      });
      const body = data as QuizSubmitResult;
      setQuizSubmitResult(body);
      setQuizAttempt(null);
      if (body?.state && itemId) setQuizStateByItemId((prev) => ({ ...prev, [itemId]: body.state }));
      void loadQuizAttemptState(courseId, itemId);
    } catch (e) {
      setQuizMetaError(e instanceof Error ? e.message : "Failed to submit quiz.");
    } finally {
      setQuizSubmitting(false);
    }
  }

  // NOTE: Avoid manual memoization here to satisfy the React Compiler lint rule
  // (`react-hooks/preserve-manual-memoization`).
  const selected = (() => {
    for (const t of topicsSorted) {
      for (const it of t.items ?? []) {
        if (it.id === selectedItemId) return { topic: t, item: it };
      }
    }
    return null;
  })();

  const selectedIndex = useMemo(() => {
    if (!selectedItemId) return -1;
    return orderedItems.findIndex((x) => x.item.id === selectedItemId);
  }, [orderedItems, selectedItemId]);

  const prev = selectedIndex > 0 ? orderedItems[selectedIndex - 1] : null;
  const next = selectedIndex >= 0 && selectedIndex < orderedItems.length - 1 ? orderedItems[selectedIndex + 1] : null;

  // When switching to a quiz item, load attempt + state from server.
  useEffect(() => {
    if (!selected || selected.item.item_type !== "quiz") return;
    // When moving to a different quiz, clear any previous result card.
    // (Keep it stable during post-submit refreshes for the SAME quiz.)
    setQuizSubmitResult(null);
    setRetakeConfirmOpen(false);
    void loadQuizAttemptState(courseId, selected.item.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, selected?.item?.id, selected?.item?.item_type]);

  // Flush quiz autosave on tab hide / page unload.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "hidden") return;
      if (!selected || selected.item.item_type !== "quiz") return;
      if (!quizAttempt?.id) return;
      flushQuizAutosave(courseId, selected.item.id, quizAnswers);
    };
    const onPageHide = () => {
      if (!selected || selected.item.item_type !== "quiz") return;
      if (!quizAttempt?.id) return;
      flushQuizAutosave(courseId, selected.item.id, quizAnswers);
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [courseId, flushQuizAutosave, quizAnswers, quizAttempt?.id, selected]);

  const persistRef = useRef<{ timer: number | null; itemId: string | null }>({ timer: null, itemId: null });

  function schedulePersist(itemId: string) {
    if (!itemId) return;
    if (persistRef.current.itemId === itemId) return;
    persistRef.current.itemId = itemId;
    if (persistRef.current.timer) window.clearTimeout(persistRef.current.timer);
    persistRef.current.timer = window.setTimeout(async () => {
      const idToPersist = persistRef.current.itemId;
      persistRef.current.timer = null;
      if (!idToPersist) return;
      try {
        await fetchJson(`/api/v2/courses/${encodeURIComponent(courseId)}/learn-progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item_id: idToPersist }),
        });
      } catch {
        // best-effort: do not block UX
      }
    }, 250);
  }

  useEffect(() => {
    const ref = persistRef;
    return () => {
      if (ref.current.timer) window.clearTimeout(ref.current.timer);
    };
  }, []);

  function toggleTopic(id: string) {
    setExpanded((prev) => {
      if (prev.has(id)) return new Set();
      return new Set([id]);
    });
  }

  function openItem(topicId: string, itemId: string) {
    // If leaving an in-progress quiz, flush answers best-effort.
    try {
      if (selected && selected.item.item_type === "quiz" && quizAttempt?.id) {
        flushQuizAutosave(courseId, selected.item.id, quizAnswers);
      }
    } catch {
      // ignore
    }

    setExpanded(new Set([topicId]));
    setSelectedItemId(itemId);
    setVisitedItemIds((prev) => {
      if (prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
    schedulePersist(itemId);
    // Bring the header into view inside the dashboard scroll container.
    document.getElementById("learn-top")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="space-y-0 border-t" id="learn-top">
      {/* 2-column learning layout (right rail removed) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 items-start">
        {/* Left: curriculum (match screenshot style) */}
        <div className="lg:col-span-4 xl:col-span-3">
          <div className="lg:sticky lg:top-0">
            <div className="bg-card overflow-hidden max-h-[calc(100vh-7rem)] flex flex-col">
              <div className="px-5 py-5 border-b">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Learning path</div>
                    <div className="mt-1 text-xl font-semibold text-foreground truncate">Get the most out of {courseTitle}</div>
                  </div>
                  <div className="shrink-0">
                    <div className="h-12 w-12 rounded-full border-4 border-muted flex items-center justify-center text-xs font-semibold text-foreground">
                      0/{orderedItems.length}
                    </div>
                  </div>
                </div>
              </div>

              <div className="divide-y flex-1 overflow-y-auto overscroll-contain">
                {topicsSorted.length === 0 ? (
                  <div className="px-5 py-5 text-sm text-muted-foreground">No content yet.</div>
                ) : (
                  topicsSorted.map((t) => {
                    const isOpen = expanded.has(t.id);
                    const items = (t.items ?? []).slice().sort((a, b) => a.position - b.position);
                    return (
                      <div key={t.id} className={cn(isOpen ? "bg-[#f7f8f9]" : "")}>
                        <button
                          type="button"
                          className={cn(
                            "w-full text-left px-5 py-4 hover:bg-muted/10 transition-colors flex items-center justify-between gap-3 cursor-pointer",
                            isOpen ? "bg-[#f7f8f9]" : "bg-background"
                          )}
                          onClick={() => toggleTopic(t.id)}
                        >
                          <div className="min-w-0 flex items-center gap-3">
                            <span className="inline-flex h-9 w-9 items-center justify-center">
                              <ChevronRight className={cn("h-4 w-4 text-foreground transition-transform", isOpen ? "rotate-90" : "")} />
                            </span>
                            <div className="min-w-0">
                              <div
                                className={cn(
                                  "text-xs font-semibold tracking-wide uppercase",
                                  isOpen ? "text-primary" : "text-foreground"
                                )}
                              >
                                {isOpen ? "Current Chapter" : "Chapter"}
                              </div>
                              <div className={cn("text-sm font-semibold truncate", isOpen ? "text-primary" : "text-muted-foreground")}>
                                {t.title}
                              </div>
                            </div>
                          </div>
                        </button>

                        {isOpen ? (
                          <div className="bg-[#f7f8f9]">
                            {items.map((it) => {
                              const active = it.id === selectedItemId;
                              const done = visitedItemIds.has(it.id);
                              const quizPassed = it.item_type === "quiz" && Boolean(quizStateByItemId[it.id]?.passed_at);
                              const duration =
                                it.item_type === "lesson"
                                  ? formatDurationPill(it.lesson?.duration_minutes ?? null)
                                  : quizPassed
                                    ? "Passed"
                                    : "Quiz";
                              return (
                                <button
                                  key={it.id}
                                  type="button"
                                  className={cn(
                                    "w-full px-5 py-3 flex items-center justify-between gap-3 hover:bg-white/70 transition-colors text-left cursor-pointer",
                                    active ? "bg-white" : ""
                                  )}
                                  onClick={() => openItem(t.id, it.id)}
                                >
                                  <div className="min-w-0 flex items-center gap-3">
                                    <span
                                      className={cn(
                                        "inline-flex h-4 w-4 rounded-full border shrink-0",
                                        done ? "bg-emerald-500 border-emerald-500" : "bg-transparent border-muted-foreground/40"
                                      )}
                                      aria-hidden
                                    />
                                    <div className="min-w-0">
                                      <div className={cn("text-sm font-medium truncate", active ? "text-primary" : "text-foreground")}>
                                        {it.title}
                                      </div>
                                    </div>
                                  </div>
                                  {duration ? (
                                    <span
                                      className={cn(
                                        "shrink-0 rounded-full text-xs font-semibold px-2.5 py-1",
                                        duration === "Passed" ? "bg-emerald-100 text-emerald-800" : "bg-primary/10 text-primary"
                                      )}
                                    >
                                      {duration}
                                    </span>
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Center: content */}
        <div className="lg:col-span-8 xl:col-span-9 min-w-0">
          <div className="border-l bg-card overflow-hidden flex flex-col">
            {/* Active item header */}
            <div className="shrink-0 border-b px-6 sm:px-10 py-5 bg-background">
              {selected ? (
                <div className="min-w-0">
                  <div className="text-xs font-semibold tracking-wide uppercase text-muted-foreground truncate">
                    {selected.topic.title}
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-foreground truncate">{selected.item.title}</div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Select a lesson or quiz from the left.</div>
              )}
            </div>

            <div className="flex-1 min-h-0">
              {!selected ? (
                <div className="p-6 sm:p-10 text-sm text-muted-foreground">Select a lesson or quiz from the left.</div>
              ) : selected.item.item_type === "lesson" ? (
                <div key={selected.item.id} className="p-6 sm:p-10 space-y-8">
                  {selected.item.lesson?.feature_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selected.item.lesson.feature_image_url}
                      alt="Lesson feature"
                      className="w-full max-h-[360px] object-cover rounded-2xl border bg-background"
                    />
                  ) : null}

                  {selected.item.lesson?.video ? (
                    <div className="rounded-2xl border bg-black overflow-hidden">
                      {selected.item.lesson.video.kind === "html5" ? (
                        <video className="w-full" controls preload="metadata">
                          <source src={selected.item.lesson.video.url} type={selected.item.lesson.video.mime} />
                        </video>
                      ) : (
                        (() => {
                          const embed = embedFromProviderUrl(selected.item.lesson!.video!.url);
                          return embed ? (
                            <div className="relative aspect-video">
                              <iframe
                                className="absolute inset-0 h-full w-full"
                                src={embed}
                                title="Lesson video"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                allowFullScreen
                                referrerPolicy="strict-origin-when-cross-origin"
                              />
                            </div>
                          ) : (
                            <div className="p-4 text-sm text-white/80 flex items-center gap-2">
                              <Lock className="h-4 w-4" />
                              Video URL is not supported.
                            </div>
                          );
                        })()
                      )}
                    </div>
                  ) : null}

                  <div className="prose prose-base sm:prose-lg max-w-none text-foreground">
                    {selected.item.lesson?.content_blocks?.length ? (
                      <div className="space-y-0">
                        {selected.item.lesson.content_blocks.map((html, idx) => {
                          const safe = (html ?? "").trim();
                          if (!safe) return null;
                          return (
                            <div key={`${selected.item.id}-blk-${idx}`} className={cn("mt-10 first:mt-0")}>
                              <div dangerouslySetInnerHTML={{ __html: safe }} />
                            </div>
                          );
                        })}
                      </div>
                    ) : selected.item.lesson?.content_html?.trim() ? (
                      <div dangerouslySetInnerHTML={{ __html: selected.item.lesson.content_html }} />
                    ) : (
                      <p className="text-muted-foreground">No lesson content yet.</p>
                    )}
                  </div>

                  <AttachmentsCard attachments={selected.item.lesson?.attachments ?? []} />
                </div>
              ) : (
                <div key={selected.item.id} className="p-6 sm:p-10 space-y-6">
                  {(() => {
                    const quiz = selected.item.quiz ?? null;
                    const settings = quiz?.settings ?? null;
                    const state = quizStateByItemId[selected.item.id] ?? null;
                    const best = typeof state?.best_score_percent === "number" ? state.best_score_percent : null;
                    const passed = Boolean(state?.passed_at);
                    const attemptsAllowed =
                      typeof quizAttemptsAllowed === "number"
                        ? quizAttemptsAllowed
                        : typeof settings?.attempts_allowed === "number"
                          ? settings.attempts_allowed
                          : null;
                    const attemptsExhausted = typeof attemptsAllowed === "number" && attemptsAllowed > 0 && quizSubmittedCount >= attemptsAllowed;

                    const perQ = new Map<string, QuizSubmitResult["per_question"][number]>(
                      (quizSubmitResult?.per_question ?? []).map((x) => [x.question_id, x])
                    );

                    return (
                      <div className="space-y-6">
                        {/* Meta header */}
                        <div className="rounded-2xl border bg-card p-5">
                          <div className="flex flex-col gap-3">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                              <div className="text-sm text-muted-foreground">Quiz</div>
                              <div className="shrink-0 flex flex-wrap items-center gap-2">
                                {best !== null ? (
                                  <span
                                    className={cn(
                                      "rounded-full px-3 py-1 text-xs font-semibold",
                                      passed ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"
                                    )}
                                  >
                                    Best: {best}%
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">No score yet</span>
                                )}
                                <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                                  Attempts:{" "}
                                  {attemptsAllowed === null
                                    ? "—"
                                    : attemptsAllowed === 0
                                      ? "Unlimited"
                                      : `${quizSubmittedCount}/${attemptsAllowed}`}
                                </span>
                                {attemptsExhausted ? (
                                  <span className="rounded-full bg-red-100 text-red-800 px-3 py-1 text-xs font-semibold">
                                    Attempts limit reached
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            {quiz?.summary_html?.trim() ? (
                              <div
                                className="prose prose-base max-w-none text-foreground"
                                dangerouslySetInnerHTML={{ __html: quiz.summary_html }}
                              />
                            ) : (
                              <div className="text-base text-muted-foreground">No quiz summary yet.</div>
                            )}
                          </div>
                        </div>

                        {quizMetaError ? (
                          <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                            {quizMetaError}
                          </div>
                        ) : null}

                        {quizMetaLoading ? (
                          <div className="rounded-2xl border bg-blue-100 p-5 text-sm text-muted-foreground flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading quiz…
                          </div>
                        ) : quizSubmitResult ? (
                          <div className="space-y-5">
                            <div className={cn("rounded-2xl border p-5", quizSubmitResult.passed ? "bg-emerald-50" : "bg-amber-50")}>
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <div className="text-xl font-semibold text-foreground">
                                    {quizSubmitResult.passed ? "Passed" : "Not passed"}
                                  </div>
                                  <div className="text-sm text-muted-foreground">
                                    Score: <span className="font-medium text-foreground">{quizSubmitResult.score_percent}%</span> • Passing score:{" "}
                                    <span className="font-medium text-foreground">{quizSubmitResult.passing_grade_percent}%</span>
                                  </div>
                                </div>
                                <Button
                                  variant="outline"
                                  onClick={() => setRetakeConfirmOpen(true)}
                                  className="shrink-0"
                                  disabled={attemptsExhausted}
                                  title={attemptsExhausted ? "Attempts limit reached" : undefined}
                                >
                                  {attemptsExhausted ? "No attempts left" : "Retake quiz"}
                                </Button>
                              </div>
                            </div>

                            {/* Review */}
                            <div className="space-y-4">
                              {(quiz?.questions ?? []).map((q, idx) => {
                                const r = perQ.get(q.id) ?? null;
                                const isCorrect = Boolean(r?.correct);
                                const qType = (q.type ?? "").toString();
                                const questionTitle = q.title?.trim() || `Question ${idx + 1}`;
                                const questionTypeLabel = qType.replace(/_/g, " ");

                                const correctBlock = (() => {
                                  if (!r || r.correct) return null;
                                  const ca = r.correct_answer;
                                  if (!ca) return null;

                                  if (ca.kind === "boolean") {
                                    return (
                                      <div className="rounded-xl border bg-muted/10 p-4">
                                        <div className="text-sm font-semibold text-foreground">This is the correct answer</div>
                                        <div className="mt-2 text-sm text-foreground">{ca.value ? "True" : "False"}</div>
                                      </div>
                                    );
                                  }

                                  const ids = Array.isArray(ca.option_ids) ? ca.option_ids : [];
                                  if (!ids.length) return null;
                                  const opts = (q.options ?? []).filter((o) => ids.includes(o.id));
                                  if (!opts.length) return null;
                                  return (
                                    <div className="rounded-xl border bg-muted/10 p-4">
                                      <div className="text-sm font-semibold text-foreground">This is the correct answer</div>
                                      <div className="mt-3 space-y-2">
                                        {opts.map((o) => {
                                          const showImage = Boolean(o.image_data_url) && o.display_format !== "only_text";
                                          const showText = o.display_format !== "only_image";
                                          return (
                                            <div key={o.id} className="rounded-lg border bg-background px-3 py-2">
                                              {showText ? <div className="text-sm text-foreground">{o.title}</div> : null}
                                              {showImage ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                  src={o.image_data_url as string}
                                                  alt={o.title || "Option image"}
                                                  className="mt-2 max-h-48 w-auto rounded-lg border bg-background object-contain"
                                                />
                                              ) : null}
                                            </div>
                                          );
                                        })}
                                      </div>
                                      {qType === "multiple_choice" ? (
                                        <div className="mt-3 text-xs text-muted-foreground">Multiple answers may be correct.</div>
                                      ) : null}
                                    </div>
                                  );
                                })();

                                return (
                                  <div key={q.id} className="rounded-2xl border bg-card p-5 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0 space-y-1">
                                        <div className="font-semibold text-foreground">
                                          Q{idx + 1} • {questionTitle}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                          {questionTypeLabel}
                                          {q.points ? ` • ${q.points} pts` : ""}
                                        </div>
                                      </div>
                                      <span
                                        className={cn(
                                          "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                                          isCorrect ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                                        )}
                                      >
                                        {isCorrect ? "Correct answer" : "Incorrect answer"}
                                      </span>
                                    </div>
                                    {q.description_html?.trim() ? (
                                      <div className="prose prose-base max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: q.description_html }} />
                                    ) : null}

                                    {correctBlock}
                                    {settings?.feedback_mode === "reveal" && q.answer_explanation_html?.trim() ? (
                                      <div className="rounded-xl border bg-muted/10 p-4">
                                        <div className="text-sm font-semibold text-foreground">Explanation</div>
                                        <div
                                          className="mt-2 prose prose-base max-w-none text-foreground"
                                          dangerouslySetInnerHTML={{ __html: q.answer_explanation_html }}
                                        />
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : quizAttempt ? (
                          <div className="space-y-4">
                            <div className="rounded-2xl border bg-blue-100 p-4 text-sm text-muted-foreground flex items-center justify-between gap-3">
                              <div>
                                Attempt <span className="font-semibold text-foreground">#{quizAttempt.attempt_number}</span> • Autosaves automatically
                              </div>
                              {quizSubmitting ? (
                                <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Submitting…
                                </span>
                              ) : null}
                            </div>

                            {(quiz?.questions ?? []).map((q, idx) => {
                              const qType = (q.type ?? "").toString();
                              const questionTitle = q.title?.trim() || `Question ${idx + 1}`;
                              const questionTypeLabel = qType.replace(/_/g, " ");
                              const answer = quizAnswers[q.id];
                              const isRequired = Boolean(q.answer_required);

                              const setAnswer = (next: unknown) => {
                                setQuizAnswers((prev) => {
                                  const merged = { ...prev, [q.id]: next };
                                  scheduleQuizAutosave(courseId, selected.item.id, quizAttempt.id, merged);
                                  return merged;
                                });
                              };

                              const toggleMulti = (optId: string, checked: boolean) => {
                                const current = new Set(Array.isArray(answer) ? (answer as unknown[]).filter((x): x is string => typeof x === "string") : []);
                                if (checked) current.add(optId);
                                else current.delete(optId);
                                setAnswer(Array.from(current));
                              };

                              return (
                                <div key={q.id} className="rounded-2xl border bg-card p-5 space-y-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 space-y-1">
                                      <div className="font-semibold text-foreground">
                                        Q{idx + 1} • {questionTitle}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        {questionTypeLabel}
                                        {q.points ? ` • ${q.points} pts` : ""}
                                        {isRequired ? "" : " • Optional"}
                                      </div>
                                    </div>
                                  </div>

                                  {q.description_html?.trim() ? (
                                    <div className="prose prose-base max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: q.description_html }} />
                                  ) : null}

                                  {qType === "true_false" ? (
                                    <div className="space-y-2">
                                      {[
                                        { id: "true", label: "True", value: true },
                                        { id: "false", label: "False", value: false },
                                      ].map((opt) => {
                                        const checked = typeof answer === "boolean" ? answer === opt.value : false;
                                        return (
                                          <label
                                            key={opt.id}
                                            className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2 cursor-pointer hover:bg-muted/30"
                                          >
                                            <input
                                              type="radio"
                                              name={`q-${q.id}`}
                                              className="h-4 w-4 accent-primary"
                                              checked={checked}
                                              onChange={() => setAnswer(opt.value)}
                                            />
                                            <span className="text-sm text-foreground">{opt.label}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  ) : qType === "multiple_choice" ? (
                                    <div className="space-y-2">
                                      {(q.options ?? []).map((o) => {
                                        const checked = Array.isArray(answer) ? (answer as unknown[]).includes(o.id) : false;
                                        const showImage = Boolean(o.image_data_url) && o.display_format !== "only_text";
                                        const showText = o.display_format !== "only_image";
                                        return (
                                          <label
                                            key={o.id}
                                            className="flex items-start gap-3 rounded-xl border bg-background px-3 py-2 cursor-pointer hover:bg-muted/30"
                                          >
                                            <input
                                              type="checkbox"
                                              className="mt-1 h-4 w-4 accent-primary"
                                              checked={checked}
                                              onChange={(e) => toggleMulti(o.id, e.target.checked)}
                                            />
                                            <div className="min-w-0 space-y-2">
                                              {showText ? <div className="text-sm text-foreground">{o.title}</div> : null}
                                              {showImage ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                  src={o.image_data_url as string}
                                                  alt={o.title || "Option image"}
                                                  className="max-h-48 w-auto rounded-lg border bg-background object-contain"
                                                />
                                              ) : null}
                                            </div>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <div className="space-y-2">
                                      {(q.options ?? []).map((o) => {
                                        const checked = typeof answer === "string" ? answer === o.id : false;
                                        const showImage = Boolean(o.image_data_url) && o.display_format !== "only_text";
                                        const showText = o.display_format !== "only_image";
                                        return (
                                          <label
                                            key={o.id}
                                            className="flex items-start gap-3 rounded-xl border bg-background px-3 py-2 cursor-pointer hover:bg-muted/30"
                                          >
                                            <input
                                              type="radio"
                                              name={`q-${q.id}`}
                                              className="mt-1 h-4 w-4 accent-primary"
                                              checked={checked}
                                              onChange={() => setAnswer(o.id)}
                                            />
                                            <div className="min-w-0 space-y-2">
                                              {showText ? <div className="text-sm text-foreground">{o.title}</div> : null}
                                              {showImage ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                  src={o.image_data_url as string}
                                                  alt={o.title || "Option image"}
                                                  className="max-h-48 w-auto rounded-lg border bg-background object-contain"
                                                />
                                              ) : null}
                                            </div>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                            <div className="flex items-center justify-end gap-2">
                              <Button
                                onClick={() => void submitQuiz(courseId, selected.item.id, quizAnswers)}
                                disabled={quizSubmitting}
                                className="gap-2"
                              >
                                {quizSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                Submit quiz
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-2xl border bg-muted/10 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                            <div className="text-sm text-muted-foreground">
                              {passed ? (
                                <>
                                  You already passed this quiz{best !== null ? ` (best score ${best}%)` : ""}. You can retake anytime.
                                </>
                              ) : (
                                <>Ready to start? Your answers will autosave as you work.</>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {passed ? (
                                <Button
                                  onClick={() => setRetakeConfirmOpen(true)}
                                  disabled={attemptsExhausted}
                                  title={attemptsExhausted ? "Attempts limit reached" : undefined}
                                >
                                  {attemptsExhausted ? "No attempts left" : "Retake quiz"}
                                </Button>
                              ) : (
                                <Button onClick={() => void startQuizAttempt(courseId, selected.item.id)} className="gap-2">
                                  Start quiz
                                </Button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Retake confirmation modal */}
                        {retakeConfirmOpen ? (
                          <div className="fixed inset-0 z-9999 bg-black/50 p-4 sm:p-6">
                            <div className="min-h-[calc(100svh-2rem)] sm:min-h-[calc(100svh-3rem)] flex items-center justify-center">
                              <div className="w-full max-w-md rounded-2xl border bg-card shadow-xl overflow-hidden">
                                <div className="px-5 py-4 border-b">
                                  <div className="text-lg font-semibold text-foreground">Retake quiz</div>
                                  <div className="mt-1 text-sm text-muted-foreground">
                                    Start a new attempt? Your previous attempt will be saved.
                                  </div>
                                </div>
                                <div className="px-5 py-4 flex items-center justify-end gap-2">
                                  <Button variant="outline" onClick={() => setRetakeConfirmOpen(false)}>
                                    Cancel
                                  </Button>
                                  <Button
                                    onClick={() => {
                                      setRetakeConfirmOpen(false);
                                      void retakeQuizAttempt(courseId, selected.item.id);
                                    }}
                                    disabled={attemptsExhausted}
                                  >
                                    {attemptsExhausted ? "Attempts limit reached" : "Start new attempt"}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {prev || next ? (
              <div className="border-t shrink-0">
                <div className="flex items-center gap-3 px-6 py-4">
                  {prev ? (
                    <Button
                      variant="outline"
                      onClick={() => openItem(prev.topic.id, prev.item.id)}
                      className="gap-2"
                      title={`Previous: ${prev.item.title}`}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                  ) : null}

                  {next ? (
                    <Button
                      onClick={() => openItem(next.topic.id, next.item.id)}
                      className={cn("gap-2", !prev ? "ml-auto" : "")}
                      title={`Next: ${next.item.title}`}
                    >
                      {selected && next.topic.id !== selected.topic.id ? next.topic.title : "Next"}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>

      </div>
    </div>
  );
}

