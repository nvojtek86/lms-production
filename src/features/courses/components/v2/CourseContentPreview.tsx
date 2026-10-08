"use client";
import {useUi} from "@/i18n/useUi";


import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Clock, ClipboardList, Lock, PlayCircle } from "lucide-react";

import { cn } from "@/lib/utils";

export type CourseContentItem = {
  id: string;
  item_type: "lesson" | "quiz";
  title: string | null;
  position: number;
  payload_json?: Record<string, unknown> | null;
};

export type CourseContentTopic = {
  id: string;
  title: string;
  position: number;
  items: CourseContentItem[];
};

function formatTotalDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.floor(totalMinutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h <= 0) return `${mm}min`;
  if (mm <= 0) return `${h}hr`;
  return `${h}hr ${mm}min`;
}

function readLessonMinutes(payload: Record<string, unknown> | null | undefined): number | null {
  if (!payload) return null;
  const playback = (payload.playback_time ?? null) as { hours?: unknown; minutes?: unknown } | null;
  if (!playback) return null;
  const h = Number(playback.hours);
  const m = Number(playback.minutes);
  if (!Number.isFinite(h) && !Number.isFinite(m)) return null;
  const hh = Number.isFinite(h) ? Math.max(0, Math.floor(h)) : 0;
  const mm = Number.isFinite(m) ? Math.max(0, Math.floor(m)) : 0;
  const total = hh * 60 + mm;
  return total > 0 ? total : null;
}

function ItemIcon({ type }: { type: CourseContentItem["item_type"] }) {
  if (type === "quiz") return <ClipboardList className="h-4 w-4 text-primary" />;
  return <PlayCircle className="h-4 w-4 text-primary" />;
}

export function CourseContentPreview({
  topics,
  locked,
}: {
  topics: CourseContentTopic[];
  locked: boolean;
}) {
  const ui = useUi();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const stats = useMemo(() => {
    let sections = 0;
    let items = 0;
    let totalMinutes = 0;
    for (const t of topics) {
      sections++;
      for (const it of t.items ?? []) {
        items++;
        if (it.item_type === "lesson") {
          const minutes = readLessonMinutes((it.payload_json ?? null) as Record<string, unknown> | null);
          if (minutes) totalMinutes += minutes;
        }
      }
    }
    return { sections, items, totalMinutes };
  }, [topics]);

  const allExpanded = expanded.size > 0 && expanded.size === topics.length;

  function toggleTopic(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setAll(nextOpen: boolean) {
    setExpanded(nextOpen ? new Set(topics.map((t) => t.id)) : new Set());
  }

  return (
    <div className="rounded-xl border bg-background overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-4 bg-muted/20 border-b">
        <div>
          <div className="text-sm font-semibold text-foreground">{ui("Course content")}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {stats.sections} {ui("section(s) • ")}{stats.items} {ui("item(s)")}{stats.totalMinutes > 0 ? ui(" • {v0} total length", {v0: formatTotalDuration(stats.totalMinutes)}) : null}
          </div>
        </div>
        <button
          type="button"
          className="text-sm font-medium text-primary hover:underline self-start sm:self-auto cursor-pointer"
          onClick={() => setAll(!allExpanded)}
        >
          {allExpanded ? ui("Collapse all sections") : ui("Expand all sections")}
        </button>
      </div>

      {topics.length === 0 ? (
        <div className="px-4 py-5 text-sm text-muted-foreground">{ui("No topics yet.")}</div>
      ) : (
        <div className="divide-y">
          {topics
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((t, idx) => {
              const isOpen = expanded.has(t.id);
              const itemsSorted = (t.items ?? []).slice().sort((a, b) => a.position - b.position);
              const lessonCount = itemsSorted.filter((i) => i.item_type === "lesson").length;
              const quizCount = itemsSorted.filter((i) => i.item_type === "quiz").length;
              const metaParts = [
                lessonCount ? `${lessonCount} lesson(s)` : null,
                quizCount ? `${quizCount} quiz(zes)` : null,
              ].filter(Boolean);

              return (
                <div key={t.id}>
                  <button
                    type="button"
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-muted/10 transition-colors flex items-start justify-between gap-4 cursor-pointer",
                      isOpen ? "bg-muted/5" : ""
                    )}
                    onClick={() => toggleTopic(t.id)}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">
                        {idx + 1}. {t.title}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {metaParts.length ? metaParts.join(" • ") : itemsSorted.length ? ui("{v0} item(s)", {v0: itemsSorted.length}) : ui("No items yet")}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                      {locked ? (
                        <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5">
                          <Lock className="h-3.5 w-3.5" />
                          {ui("Locked")}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5">
                          {ui("Preview")}</span>
                      )}
                      {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </button>

                  {isOpen ? (
                    <div className="bg-muted/5">
                      {itemsSorted.length === 0 ? (
                        <div className="px-4 py-4 text-sm text-muted-foreground">{ui("No items in this section yet.")}</div>
                      ) : (
                        <div className="divide-y border-t">
                          {itemsSorted.map((it) => {
                            const minutes = it.item_type === "lesson" ? readLessonMinutes((it.payload_json ?? null) as Record<string, unknown> | null) : null;
                            return (
                              <div key={it.id} className="px-4 py-3 flex items-center justify-between gap-4">
                                <div className="min-w-0 flex items-center gap-3">
                                  <ItemIcon type={it.item_type} />
                                  <div className="min-w-0">
                                    <div className="text-sm text-foreground truncate">{it.title?.trim() || ui("(untitled)")}</div>
                                    <div className="mt-0.5 text-xs text-muted-foreground uppercase">{it.item_type}</div>
                                  </div>
                                </div>
                                <div className="shrink-0 text-xs text-muted-foreground flex items-center gap-3">
                                  {minutes ? (
                                    <span className="inline-flex items-center gap-1">
                                      <Clock className="h-3.5 w-3.5" />
                                      {formatTotalDuration(minutes)}
                                    </span>
                                  ) : null}
                                  {locked ? <Lock className="h-4 w-4" /> : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

