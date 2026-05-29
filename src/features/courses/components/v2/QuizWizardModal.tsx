"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  ArrowDownUp,
  Brackets,
  CheckSquare,
  Image as ImageIcon,
  Images,
  Link2,
  ListChecks,
  MoreVertical,
  Pencil,
  Plus,
  TextCursorInput,
  Timer,
  ToggleLeft,
  Trash2,
  X,
} from "lucide-react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { coercePercentInt, sanitizePercentIntText } from "@/lib/percentInput";
import { RichTextEditorWithUploads } from "@/features/courses/components/v2/RichTextEditorWithUploads";
import { revokeInlineQueueObjectUrls, type InlineImageQueue } from "@/lib/richtext/inlineImages";

export type QuizWizardSavePayload = {
  title: string;
  payload_json: Record<string, unknown>;
  inline_images?: InlineImageQueue;
};

type QuizFeedbackMode = "default" | "reveal";
type QuizTimeUnit = "seconds" | "minutes" | "hours";

export type QuizQuestionType =
  | "true_false"
  | "single_choice"
  | "multiple_choice"
  | "fill_in_the_blanks"
  | "short_answer"
  | "matching"
  | "image_matching"
  | "image_answering"
  | "ordering";

type QuizOptionDisplayFormat = "only_text" | "only_image" | "text_and_image_both";

type QuizOption = {
  id: string;
  title: string;
  image_data_url: string | null;
  image_upload_id?: string | null;
  display_format: QuizOptionDisplayFormat;
  position: number;
};

function isSupportedAnswerType(type: QuizQuestionType): type is "true_false" | "single_choice" | "multiple_choice" {
  return type === "true_false" || type === "single_choice" || type === "multiple_choice";
}

function applyQuestionTypeChange(prev: QuizQuestion, nextType: QuizQuestionType): QuizQuestion {
  if (prev.type === nextType) return prev;

  // Convert correctness state between types.
  if (nextType === "true_false") {
    return {
      ...prev,
      type: nextType,
      options: [],
      correct_option_id: null,
      correct_option_ids: [],
      correct_boolean: typeof prev.correct_boolean === "boolean" ? prev.correct_boolean : true,
    };
  }

  if (prev.type === "true_false") {
    // Moving from T/F to choice: keep question text/explanation, start with empty options.
    return {
      ...prev,
      type: nextType,
      options: [],
      correct_option_id: null,
      correct_option_ids: [],
      correct_boolean: undefined,
    };
  }

  // Moving between single/multi:
  const correctIds = Array.isArray(prev.correct_option_ids) ? prev.correct_option_ids.filter(Boolean) : [];
  const correctId = prev.correct_option_id ?? (correctIds[0] ?? null);
  if (nextType === "single_choice") {
    return {
      ...prev,
      type: nextType,
      correct_option_id: correctId,
      correct_option_ids: correctId ? [correctId] : [],
    };
  }
  if (nextType === "multiple_choice") {
    const nextIds = correctIds.length ? correctIds : correctId ? [correctId] : [];
    return {
      ...prev,
      type: nextType,
      correct_option_id: nextIds[0] ?? null,
      correct_option_ids: nextIds,
    };
  }

  // Other types (future): keep as-is for now.
  return { ...prev, type: nextType };
}

type QuizQuestion = {
  id: string;
  title: string;
  type: QuizQuestionType;
  answer_required: boolean;
  randomize: boolean;
  points: number;
  display_points: boolean;
  description_html: string;
  options: QuizOption[];
  correct_option_id: string | null;
  correct_option_ids?: string[];
  correct_boolean?: boolean;
  answer_explanation_mode?: "all" | "none" | "correct_only" | "incorrect_only";
  answer_explanation_correct_html?: string;
  answer_explanation_incorrect_html?: string;
  answer_explanation_html: string;
};

type QuizSettings = {
  time_limit_value: number;
  time_limit_unit: QuizTimeUnit;
  hide_quiz_time_display: boolean;
  feedback_mode: QuizFeedbackMode;
  attempts_allowed: number; // 0 = no limit
  passing_grade_percent: number;
  max_questions_allowed_to_answer: number;
};

type QuizV1Payload = {
  kind: "quiz_v1";
  title: string;
  summary: string;
  questions: QuizQuestion[];
  settings: QuizSettings;
};

function makeId(prefix: string) {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }
}

function clampInt(v: number, min: number, max: number) {
  const n = Number.isFinite(v) ? Math.floor(v) : min;
  return Math.max(min, Math.min(max, n));
}

function composeAnswerExplanationHtml(
  mode: QuizQuestion["answer_explanation_mode"],
  correctHtml: string,
  incorrectHtml: string
): string {
  if (mode === "none") return "";
  if (mode === "correct_only") return correctHtml;
  if (mode === "incorrect_only") return incorrectHtml;
  const trimmedCorrect = correctHtml.trim();
  const trimmedIncorrect = incorrectHtml.trim();
  if (trimmedCorrect && trimmedIncorrect) {
    return `<p><strong>Correct answer explanation</strong></p>${correctHtml}<hr /><p><strong>Incorrect answer explanation</strong></p>${incorrectHtml}`;
  }
  return trimmedCorrect ? correctHtml : incorrectHtml;
}

function normalizePayload(initial: Record<string, unknown> | null | undefined, fallbackTitle: string, fallbackSummary: string): QuizV1Payload {
  const base = (initial ?? {}) as Partial<QuizV1Payload>;
  const settings = (base.settings ?? {}) as Partial<QuizSettings>;
  const rawQuestions = Array.isArray(base.questions) ? (base.questions as Array<Record<string, unknown>>) : [];
  return {
    kind: "quiz_v1",
    title: typeof base.title === "string" ? base.title : fallbackTitle,
    summary: typeof base.summary === "string" ? base.summary : fallbackSummary,
    questions: rawQuestions.map((q) => {
      const type = (q.type as QuizQuestionType) || "single_choice";
      const options = Array.isArray(q.options) ? (q.options as QuizOption[]) : [];
      const correctIds = Array.isArray(q.correct_option_ids) ? (q.correct_option_ids as string[]).filter(Boolean) : [];
      const correctId = typeof q.correct_option_id === "string" ? q.correct_option_id : null;
      const correctBoolean = typeof q.correct_boolean === "boolean" ? q.correct_boolean : true;
      const legacyExplanation = typeof q.answer_explanation_html === "string" ? q.answer_explanation_html : "";
      const answerExplanationMode =
        q.answer_explanation_mode === "all" ||
        q.answer_explanation_mode === "none" ||
        q.answer_explanation_mode === "correct_only" ||
        q.answer_explanation_mode === "incorrect_only"
          ? q.answer_explanation_mode
          : "none";
      return {
        id: typeof q.id === "string" ? q.id : makeId("q"),
        title: typeof q.title === "string" ? q.title : "",
        type,
        answer_required: Boolean(q.answer_required ?? true),
        randomize: Boolean(q.randomize ?? false),
        points: clampInt(Number(q.points ?? 1), 0, 999),
        display_points: Boolean(q.display_points ?? false),
        description_html: typeof q.description_html === "string" ? q.description_html : "",
        options: options
          .slice()
          .map((o, idx) => ({
            id: typeof (o as { id?: unknown }).id === "string" ? String((o as { id: string }).id) : makeId("opt"),
            title: typeof (o as { title?: unknown }).title === "string" ? String((o as { title: string }).title) : "",
            image_data_url: typeof (o as { image_data_url?: unknown }).image_data_url === "string" ? String((o as { image_data_url: string }).image_data_url) : null,
            image_upload_id: typeof (o as { image_upload_id?: unknown }).image_upload_id === "string" ? String((o as { image_upload_id: string }).image_upload_id) : null,
            display_format:
              (o as { display_format?: unknown }).display_format === "only_image" ||
              (o as { display_format?: unknown }).display_format === "text_and_image_both"
                ? ((o as { display_format: QuizOptionDisplayFormat }).display_format as QuizOptionDisplayFormat)
                : "only_text",
            position: Number.isFinite(Number((o as { position?: unknown }).position)) ? Number((o as { position: number }).position) : idx,
          }))
          .sort((a, b) => a.position - b.position)
          .map((o, idx) => ({ ...o, position: idx })),
        correct_option_id: correctId,
        correct_option_ids: correctIds.length ? correctIds : correctId ? [correctId] : [],
        correct_boolean: correctBoolean,
        answer_explanation_mode: answerExplanationMode,
        answer_explanation_correct_html:
          typeof q.answer_explanation_correct_html === "string" ? q.answer_explanation_correct_html : legacyExplanation,
        answer_explanation_incorrect_html:
          typeof q.answer_explanation_incorrect_html === "string" ? q.answer_explanation_incorrect_html : legacyExplanation,
        answer_explanation_html: legacyExplanation,
      } as QuizQuestion;
    }),
    settings: {
      time_limit_value: clampInt(Number(settings.time_limit_value ?? 0), 0, 9999),
      time_limit_unit: (settings.time_limit_unit === "seconds" || settings.time_limit_unit === "minutes" || settings.time_limit_unit === "hours"
        ? settings.time_limit_unit
        : "minutes") as QuizTimeUnit,
      hide_quiz_time_display: Boolean(settings.hide_quiz_time_display ?? false),
      feedback_mode: (settings.feedback_mode === "reveal" ? "reveal" : "default") as QuizFeedbackMode,
      attempts_allowed: (() => {
        const raw = Number((settings as { attempts_allowed?: unknown }).attempts_allowed ?? 0);
        return Number.isFinite(raw) ? clampInt(raw, 0, 10) : 0;
      })(),
      passing_grade_percent: clampInt(Number(settings.passing_grade_percent ?? 80), 0, 100),
      max_questions_allowed_to_answer: clampInt(Number(settings.max_questions_allowed_to_answer ?? 10), 1, 500),
    },
  };
}

const QUESTION_TYPE_OPTIONS: Array<{ id: QuizQuestionType; label: string }> = [
  { id: "true_false", label: "True/False" },
  { id: "single_choice", label: "Single choice" },
  { id: "multiple_choice", label: "Multiple Choice" },
  { id: "fill_in_the_blanks", label: "Fill In The Blanks" },
  { id: "short_answer", label: "Short Answer" },
  { id: "matching", label: "Matching" },
  { id: "image_matching", label: "Image Matching" },
  { id: "image_answering", label: "Image Answering" },
  { id: "ordering", label: "Ordering" },
];

const ENABLED_QUESTION_TYPES = new Set<QuizQuestionType>(["true_false", "single_choice", "multiple_choice"]);

function questionTypeMeta(type: QuizQuestionType): { label: string; icon: React.ReactNode; iconWrapClass: string } {
  const label = QUESTION_TYPE_OPTIONS.find((t) => t.id === type)?.label ?? type;
  switch (type) {
    case "true_false":
      return { label, icon: <ToggleLeft className="h-4 w-4" />, iconWrapClass: "bg-blue-500/10 text-blue-600" };
    case "single_choice":
      return { label, icon: <CheckSquare className="h-4 w-4" />, iconWrapClass: "bg-emerald-500/10 text-emerald-700" };
    case "multiple_choice":
      return { label, icon: <ListChecks className="h-4 w-4" />, iconWrapClass: "bg-violet-500/10 text-violet-700" };
    case "fill_in_the_blanks":
      return { label, icon: <Brackets className="h-4 w-4" />, iconWrapClass: "bg-amber-500/10 text-amber-800" };
    case "short_answer":
      return { label, icon: <TextCursorInput className="h-4 w-4" />, iconWrapClass: "bg-orange-500/10 text-orange-800" };
    case "matching":
      return { label, icon: <Link2 className="h-4 w-4" />, iconWrapClass: "bg-slate-500/10 text-slate-700" };
    case "image_matching":
      return { label, icon: <Images className="h-4 w-4" />, iconWrapClass: "bg-pink-500/10 text-pink-700" };
    case "image_answering":
      return { label, icon: <ImageIcon className="h-4 w-4" />, iconWrapClass: "bg-fuchsia-500/10 text-fuchsia-700" };
    case "ordering":
      return { label, icon: <ArrowDownUp className="h-4 w-4" />, iconWrapClass: "bg-indigo-500/10 text-indigo-700" };
    default:
      return { label, icon: <ClipboardList className="h-4 w-4" />, iconWrapClass: "bg-muted text-muted-foreground" };
  }
}

function QFieldLabel({
  children,
  accent = "#1b8755",
  required = false,
}: {
  children: React.ReactNode;
  accent?: string;
  required?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "7px" }}>
      <span style={{ display: "block", width: 3, height: 16, borderRadius: 2, background: accent, flexShrink: 0 }} />
      <span style={{ fontWeight: 700, fontSize: "13px", color: "#1a1a1a", letterSpacing: "0.01em" }}>
        {children}
        {required ? <span aria-hidden="true"> *</span> : null}
      </span>
    </div>
  );
}

const STEP_GRADIENTS = [
  "linear-gradient(135deg, #53a47f 0%, #3d9e6d 50%, #1b8755 100%)",
  "linear-gradient(135deg, #1b6bb8 0%, #1a5da6 50%, #144a8a 100%)",
  "linear-gradient(135deg, #7c3abd 0%, #6a31a6 50%, #5a2491 100%)",
];
const STEP_SHADOWS = [
  "0 6px 20px rgba(27,135,85,0.38)",
  "0 6px 20px rgba(27,107,184,0.38)",
  "0 6px 20px rgba(124,58,189,0.38)",
];
const STEP_ICONS = ["📋", "❓", "⚙️"];

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: "Quiz Info" },
    { n: 2, label: "Questions" },
    { n: 3, label: "Settings" },
  ] as const;

  return (
    <div
      style={{
        padding: "12px 20px 16px",
        background: "linear-gradient(135deg, #c8edd8 0%, #b3e5c4 50%, #a5deb8 100%)",
        borderBottom: "1px solid rgba(27,135,85,0.12)",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
        {steps.map((s) => {
          const done = step > s.n;
          const active = step === s.n;
          const idx = s.n - 1;
          return (
            <div
              key={s.n}
              title={done ? "Completed step" : active ? "Current step" : "Upcoming step"}
              style={active ? {
                background: STEP_GRADIENTS[idx],
                backgroundSize: "200% 200%",
                animation: "cb-gradient-shift 8s ease infinite",
                boxShadow: STEP_SHADOWS[idx],
                border: "1px solid rgba(255,255,255,0.35)",
                color: "#ffffff",
                borderRadius: "12px",
                padding: "10px 14px",
                transform: "translateY(-1px)",
              } : done ? {
                background: "rgba(255,255,255,0.95)",
                border: `1px solid ${idx === 0 ? "rgba(27,135,85,0.3)" : idx === 1 ? "rgba(27,107,184,0.3)" : "rgba(124,58,189,0.3)"}`,
                color: idx === 0 ? "#1b8755" : idx === 1 ? "#1b6bb8" : "#7c3abd",
                borderRadius: "12px",
                padding: "10px 14px",
                boxShadow: "0 1px 6px rgba(0,0,0,0.07)",
              } : {
                background: "rgba(255,255,255,0.65)",
                border: "1px solid rgba(255,255,255,0.5)",
                color: "#9ca3af",
                borderRadius: "12px",
                padding: "10px 14px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                <span style={{ fontWeight: 700, fontSize: "13px" }}>{STEP_ICONS[idx]} {s.label}</span>
                {done ? <Check className="h-3.5 w-3.5" /> : null}
              </div>
              <div style={{ fontSize: "10px", marginTop: "2px", opacity: 0.82 }}>
                {done ? "Completed" : active ? "In progress" : "Not started"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex items-center gap-2 text-sm select-none", disabled && "opacity-60")}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 items-center rounded-full border transition-colors p-[2px] overflow-hidden",
          checked ? "bg-primary border-primary" : "bg-muted border-border",
          disabled ? "cursor-not-allowed" : "cursor-pointer"
        )}
        aria-pressed={checked}
      >
        <span
          className={cn(
            "h-4 w-4 rounded-full bg-background shadow-sm transition-transform will-change-transform",
            checked ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
      <span>{label}</span>
    </label>
  );
}

function SortableOptionRow({
  option,
  selectionMode,
  selected,
  onToggleSelected,
  onEdit,
  onDelete,
  isEditing = false,
  onCloseEdit,
  children,
}: {
  option: QuizOption;
  selectionMode: "single" | "multi";
  selected: boolean;
  onToggleSelected: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isEditing?: boolean;
  onCloseEdit?: () => void;
  children?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: option.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  /* ── Expanded / editing state: single unified card ── */
  if (isEditing) {
    return (
      <div
        ref={setNodeRef}
        style={{
          ...style,
          borderRadius: "14px",
          border: "2px solid rgba(27,107,184,0.45)",
          background: "#ffffff",
          boxShadow: "0 6px 28px rgba(27,107,184,0.18), 0 2px 8px rgba(0,0,0,0.07)",
          overflow: "hidden",
          opacity: isDragging ? 0.75 : 1,
          transition: "box-shadow 200ms, opacity 200ms",
        }}
      >
        {/* ── Card header (replaces the standalone row) ── */}
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 14px",
            background: "linear-gradient(135deg, #dbeafe 0%, #ede9ff 100%)",
            borderBottom: "1.5px solid rgba(27,107,184,0.18)",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
            {/* Correct-answer toggle (radio / checkbox) */}
            <button
              type="button"
              onClick={onToggleSelected}
              title={selectionMode === "multi" ? "Toggle correct" : "Mark as correct"}
              style={{
                width: 22, height: 22, flexShrink: 0,
                border: selected ? "2px solid #1b6bb8" : "2px solid #aaa",
                borderRadius: selectionMode === "multi" ? "5px" : "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: selected ? "rgba(27,107,184,0.1)" : "#fff",
                cursor: "pointer",
                transition: "all 160ms",
              }}
            >
              {selected ? (
                selectionMode === "multi" ? (
                  <Check className="h-3.5 w-3.5" style={{ color: "#1b6bb8" }} />
                ) : (
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#1b6bb8", display: "block" }} />
                )
              ) : null}
            </button>

            {/* Title + meta */}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: "13px", color: "#1b5fa0", letterSpacing: "0.01em", display: "flex", alignItems: "center", gap: "5px" }}>
                <Pencil style={{ width: 12, height: 12, flexShrink: 0 }} />
                <span className="truncate">{option.title?.trim() || "(new option)"}</span>
              </div>
              <div style={{ fontSize: "11px", color: "#7b8fa8", marginTop: "2px" }}>
                {option.display_format === "only_text" ? "Only text" : option.display_format === "only_image" ? "Only image" : "Text & image"}
                {option.image_data_url ? " · has image" : ""}
                {selected ? " · ✓ correct" : ""}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
            {/* Drag handle */}
            <button
              type="button"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 30, height: 30, borderRadius: "8px",
                background: "rgba(27,107,184,0.1)", border: "none",
                cursor: "grab", color: "#1b6bb8",
              }}
              title="Drag to reorder"
              {...attributes}
              {...listeners}
            >
              <MoreVertical className="h-4 w-4" />
            </button>
            {/* Delete */}
            <button
              type="button"
              onClick={onDelete}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 30, height: 30, borderRadius: "8px",
                background: "rgba(220,38,38,0.08)", border: "none",
                cursor: "pointer", color: "#dc2626",
              }}
              title="Delete option"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            {/* Collapse / close */}
            <button
              type="button"
              onClick={onCloseEdit}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 30, height: 30, borderRadius: "8px",
                background: "rgba(0,0,0,0.06)", border: "none",
                cursor: "pointer", color: "#555",
              }}
              title="Collapse editor"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Card body (editing fields) ── */}
        <div style={{ padding: "18px 16px", display: "flex", flexDirection: "column", gap: "18px" }}>
          {children}

          {/* ── Footer: Done / collapse button ── */}
          {(() => {
            const hasAnswer = option.title.trim().length > 0;
            return (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", paddingTop: "4px", borderTop: "1px solid rgba(27,107,184,0.12)" }}>
                {!hasAnswer ? (
                  <span style={{ fontSize: "12px", color: "#e05c2a", fontWeight: 600, display: "flex", alignItems: "center", gap: "5px" }}>
                    ⚠ Answer text is required before saving.
                  </span>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  disabled={!hasAnswer}
                  onClick={hasAnswer ? onCloseEdit : undefined}
                  title={hasAnswer ? "Save and collapse" : "Type an answer before saving"}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "7px",
                    borderRadius: "9px",
                    border: "none",
                    background: hasAnswer
                      ? "linear-gradient(135deg, #1b6bb8, #144a8a)"
                      : "rgba(0,0,0,0.1)",
                    boxShadow: hasAnswer ? "0 3px 12px rgba(27,107,184,0.35)" : "none",
                    padding: "8px 20px",
                    fontSize: "13px", fontWeight: 700,
                    color: hasAnswer ? "#ffffff" : "#aaa",
                    cursor: hasAnswer ? "pointer" : "not-allowed",
                    transition: "all 180ms",
                    opacity: hasAnswer ? 1 : 0.6,
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                  Done
                </button>
              </div>
            );
          })()}
        </div>
      </div>
    );
  }

  /* ── Collapsed / normal state: compact row ── */
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("flex items-center justify-between rounded-md border bg-background px-3 py-2", isDragging && "opacity-70 shadow-md")}
    >
      <div className="min-w-0 flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleSelected}
          title={selectionMode === "multi" ? "Toggle correct" : "Mark as correct"}
          className={cn(
            "h-5 w-5 border flex items-center justify-center",
            selectionMode === "multi" ? "rounded-sm" : "rounded-full"
          )}
        >
          {selected ? (
            selectionMode === "multi" ? (
              <Check className="h-4 w-4 text-primary" />
            ) : (
              <span className="h-3 w-3 rounded-full bg-primary" />
            )
          ) : null}
        </button>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{option.title?.trim() || "(untitled option)"}</div>
          <div className="text-[11px] text-muted-foreground">
            {option.display_format === "only_text" ? "Only text" : option.display_format === "only_image" ? "Only image" : "Text & image"}
            {option.image_data_url ? " · image" : ""}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" onClick={onEdit} title="Edit option">
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Drag to reorder"
          className="cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onDelete} title="Delete option">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function TrueFalseCorrectSelector({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="text-sm font-medium text-foreground">Correct answer</div>
      <div className="mt-3 flex items-center gap-3">
        <span className={cn("text-sm", !value ? "text-foreground font-medium" : "text-muted-foreground")}>False</span>
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={cn(
            "relative inline-flex h-6 w-12 items-center rounded-full border transition-colors p-[2px] overflow-hidden cursor-pointer",
            value ? "bg-primary border-primary" : "bg-muted border-border"
          )}
          aria-pressed={value}
          title="Toggle correct answer"
        >
          <span className={cn("h-5 w-5 rounded-full bg-background shadow-sm transition-transform", value ? "translate-x-6" : "translate-x-0")} />
        </button>
        <span className={cn("text-sm", value ? "text-foreground font-medium" : "text-muted-foreground")}>True</span>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">Choose whether the correct answer is True or False.</div>
    </div>
  );
}

export function QuizWizardModal({
  mode,
  initialTitle,
  initialSummary,
  initialPayloadJson,
  onClose,
  onSave,
}: {
  mode: "create" | "edit";
  initialTitle: string;
  initialSummary: string;
  initialPayloadJson?: Record<string, unknown> | null;
  onClose: () => void;
  onSave: (payload: QuizWizardSavePayload) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const init = useMemo(() => normalizePayload(initialPayloadJson, initialTitle, initialSummary), [initialPayloadJson, initialSummary, initialTitle]);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [title, setTitle] = useState(init.title ?? initialTitle);
  const [summary, setSummary] = useState(init.summary ?? initialSummary);
  const [questions, setQuestions] = useState<QuizQuestion[]>(init.questions ?? []);
  const [settings, setSettings] = useState<QuizSettings>(init.settings);
  const [passingGradePercentInput, setPassingGradePercentInput] = useState<string>(() => String(init.settings.passing_grade_percent ?? 0));

  const [editingQuestion, setEditingQuestion] = useState<QuizQuestion | null>(null);
  const [optionEditorId, setOptionEditorId] = useState<string | null>(null);
  const [questionTypeOpen, setQuestionTypeOpen] = useState(false);
  const [isOptionImageDragActive, setIsOptionImageDragActive] = useState(false);

  const [editingQuestionBaseline, setEditingQuestionBaseline] = useState<string>("");
  const pendingExitActionRef = useRef<"close" | "back" | null>(null);
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [queuedInlineImages, setQueuedInlineImages] = useState<InlineImageQueue>({});

  const focusField = "focus-visible:ring-0 focus-visible:ring-offset-0";
  const focusWithinField = "";
  const selectBase = "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none";
  const selectFocus = "focus:ring-0 focus:outline-none";

  const attemptsAllowedSafe = Number.isFinite(Number((settings as { attempts_allowed?: unknown }).attempts_allowed))
    ? Number((settings as { attempts_allowed?: unknown }).attempts_allowed)
    : 0;

  function upsertQuestion(q: QuizQuestion) {
    setQuestions((prev) => {
      const idx = prev.findIndex((x) => x.id === q.id);
      if (idx < 0) return [...prev, q];
      const next = prev.slice();
      next[idx] = q;
      return next;
    });
  }

  function removeQuestion(questionId: string) {
    setQuestions((prev) => prev.filter((q) => q.id !== questionId));
  }

  function goNext() {
    if (step === 1) {
      if (title.trim().length < 2) {
        toast.error("Quiz title must be at least 2 characters.");
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      // Allow no questions for now (can be enforced later).
      setStep(3);
      return;
    }
  }

  function closeAndCleanup() {
    revokeInlineQueueObjectUrls(queuedInlineImages ?? {});
    setQueuedInlineImages({});
    onClose();
  }

  const isEditingQuestionDirty = useMemo(() => {
    if (!editingQuestion) return false;
    try {
      return JSON.stringify(editingQuestion) !== editingQuestionBaseline;
    } catch {
      return true;
    }
  }, [editingQuestion, editingQuestionBaseline]);

  function requestExit(action: "close" | "back") {
    if (isEditingQuestionDirty) {
      pendingExitActionRef.current = action;
      setConfirmExitOpen(true);
      return;
    }
    if (action === "close") closeAndCleanup();
    else goBack();
  }

  function goBack() {
    if (editingQuestion) {
      setEditingQuestion(null);
      setOptionEditorId(null);
      return;
    }
    setStep((s) => (s === 1 ? 1 : ((s - 1) as 1 | 2 | 3)));
  }

  function finalizeSave() {
    if (title.trim().length < 2) {
      toast.error("Quiz title must be at least 2 characters.");
      setStep(1);
      return;
    }

    const payload: QuizV1Payload = {
      kind: "quiz_v1",
      title: title.trim(),
      summary: summary,
      questions,
      settings,
    };

    onSave({ title: payload.title, payload_json: payload as unknown as Record<string, unknown>, inline_images: queuedInlineImages });
    toast.success(mode === "create" ? "Quiz created." : "Quiz updated.");
    setQueuedInlineImages({});
    onClose();
  }

  function startNewQuestion() {
    setOptionEditorId(null);
    const q: QuizQuestion = {
      id: makeId("q"),
      title: "",
      type: "single_choice",
      answer_required: true,
      randomize: false,
      points: 1,
      display_points: false,
      description_html: "",
      options: [],
      correct_option_id: null,
      correct_option_ids: [],
      correct_boolean: true,
      answer_explanation_mode: "none",
      answer_explanation_correct_html: "",
      answer_explanation_incorrect_html: "",
      answer_explanation_html: "",
    };
    try {
      setEditingQuestionBaseline(JSON.stringify(q));
    } catch {
      setEditingQuestionBaseline("");
    }
    setEditingQuestion(q);
  }

  function openEditQuestion(q: QuizQuestion) {
    setOptionEditorId(null);
    try {
      setEditingQuestionBaseline(JSON.stringify(q));
    } catch {
      setEditingQuestionBaseline("");
    }
    setEditingQuestion(q);
  }

  function commitEditingQuestion(): boolean {
    if (!editingQuestion) return false;

    if (editingQuestion.title.trim().length < 2) {
      toast.error("Question title must be at least 2 characters.");
      return false;
    }

    if (!isSupportedAnswerType(editingQuestion.type)) {
      toast.error("This question type is not supported yet. Please use True/False, Single choice, or Multiple Choice.");
      return false;
    }

    if (editingQuestion.type === "true_false") {
      const normalized: QuizQuestion = {
        ...editingQuestion,
        options: [],
        correct_option_id: null,
        correct_option_ids: [],
        correct_boolean: typeof editingQuestion.correct_boolean === "boolean" ? editingQuestion.correct_boolean : true,
      };
      upsertQuestion(normalized);
      setEditingQuestion(null);
      setOptionEditorId(null);
      toast.success("Question saved.");
      return true;
    }

    if (editingQuestion.options.length < 2) {
      toast.error("Add at least 2 options.");
      return false;
    }
    if (editingQuestion.type === "single_choice") {
      if (!editingQuestion.correct_option_id) {
        toast.error("Select the correct answer.");
        return false;
      }
    } else if (editingQuestion.type === "multiple_choice") {
      if (!(editingQuestion.correct_option_ids ?? []).length) {
        toast.error("Select one or more correct answers.");
        return false;
      }
    }

    const normalized: QuizQuestion = {
      ...editingQuestion,
      options: editingQuestion.options
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((o, idx) => ({ ...o, position: idx })),
      correct_option_ids:
        editingQuestion.type === "multiple_choice"
          ? (editingQuestion.correct_option_ids ?? []).filter(Boolean)
          : editingQuestion.correct_option_id
            ? [editingQuestion.correct_option_id]
            : [],
      correct_boolean: undefined,
    };
    upsertQuestion(normalized);
    setEditingQuestion(null);
    setOptionEditorId(null);
    toast.success("Question saved.");
    return true;
  }

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!isEditingQuestionDirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isEditingQuestionDirty]);

  async function uploadOptionImage(file: File) {
    if (!editingQuestion || !optionEditorId) return;
    const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
    if (!allowed.has(file.type)) {
      toast.error("Invalid image type. Allowed: PNG, JPG, WebP, GIF.");
      return;
    }
    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      toast.error("Image is too large (max 5MB).");
      return;
    }
    const uploadId = makeId("option_image");
    const objectUrl = URL.createObjectURL(file);
    const previousUploadId = editingQuestion.options.find((o) => o.id === optionEditorId)?.image_upload_id ?? null;
    setQueuedInlineImages((prev) => {
      const next = { ...prev };
      if (previousUploadId) {
        const existing = next[previousUploadId];
        if (existing?.objectUrl) URL.revokeObjectURL(existing.objectUrl);
        delete next[previousUploadId];
      }
      next[uploadId] = { file, objectUrl };
      return next;
    });
    setEditingQuestion((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        options: prev.options.map((o) => (o.id === optionEditorId ? { ...o, image_data_url: objectUrl, image_upload_id: uploadId } : o)),
      };
    });
  }

  const content = (
    <div
      className="cb-quiz-form p-5 space-y-6 max-h-[70vh] overflow-auto"
      style={{ background: "linear-gradient(160deg, #fafffe 0%, #f5fbf8 60%, #f8f6ff 100%)" }}
    >
      {step === 1 ? (
        <div className="space-y-6">
          <div>
            <QFieldLabel required>Quiz Title</QFieldLabel>
            <Input
              className={cn(focusField)}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Type your quiz title here"
            />
          </div>
          <div>
            <QFieldLabel>Summary</QFieldLabel>
            <Textarea
              className={cn(focusField)}
              rows={8}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Write a short summary"
            />
          </div>
        </div>
      ) : step === 2 ? (
        <div className="space-y-4">
          {!editingQuestion ? (
            <>
              {questions.length ? (
                <div className="space-y-3">
                  {questions.map((q, idx) => (
                    <div
                      key={q.id}
                      style={{
                        borderRadius: "10px",
                        border: "1px solid rgba(27,107,184,0.18)",
                        borderLeft: "3px solid #1b6bb8",
                        background: "#ffffff",
                        padding: "10px 14px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                        boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
                      }}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {idx + 1}. {q.title.trim() || "(untitled question)"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {QUESTION_TYPE_OPTIONS.find((t) => t.id === q.type)?.label ?? q.type}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => openEditQuestion(q)} title="Edit question">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeQuestion(q.id)} title="Delete question">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <button
                type="button"
                onClick={startNewQuestion}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "8px",
                  borderRadius: "10px",
                  border: "1.5px solid rgba(27,107,184,0.28)",
                  background: "rgba(27,107,184,0.05)",
                  padding: "8px 18px",
                  fontSize: "13px", fontWeight: 700, color: "#1b6bb8",
                  cursor: "pointer",
                  boxShadow: "0 1px 4px rgba(27,107,184,0.1)",
                  transition: "all 150ms",
                }}
              >
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 22, height: 22, borderRadius: "6px",
                  background: "linear-gradient(135deg, #1b6bb8, #144a8a)",
                  boxShadow: "0 2px 6px rgba(27,107,184,0.35)",
                  flexShrink: 0,
                }}>
                  <Plus className="h-3.5 w-3.5 text-white" />
                </span>
                Add Question
              </button>
            </>
          ) : (
            <div
              className="space-y-6"
              style={{
                borderRadius: "14px",
                border: "1px solid rgba(27,135,85,0.12)",
                background: "#ffffff",
                padding: "20px",
                boxShadow: "0 4px 18px rgba(0,0,0,0.07)",
              }}
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={() => requestExit("back")}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>
              </div>

              <div>
                <QFieldLabel accent="#1b6bb8" required>Write your question here</QFieldLabel>
                <Input
                  className={cn(focusField)}
                  value={editingQuestion.title}
                  onChange={(e) => setEditingQuestion((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                  placeholder="Question 1"
                />
              </div>

              <div>
                <QFieldLabel accent="#1b6bb8">Select your question type</QFieldLabel>
                <div className="relative">
                  {(() => {
                    const meta = questionTypeMeta(editingQuestion.type);
                    return (
                  <button
                    type="button"
                    className={cn(
                      "w-full h-10 rounded-md border bg-background px-3 text-sm flex items-center justify-between cursor-pointer",
                      focusField
                    )}
                    onClick={() => setQuestionTypeOpen((v) => !v)}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={cn("h-6 w-6 rounded-md flex items-center justify-center shrink-0", meta.iconWrapClass)}>
                        {meta.icon}
                      </span>
                      <span className="truncate">{meta.label}</span>
                    </span>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", questionTypeOpen ? "rotate-180" : "")} />
                  </button>
                    );
                  })()}

                  {questionTypeOpen ? (
                    <div
                      className="absolute z-50 mt-2 w-full"
                      style={{
                        borderRadius: "14px",
                        border: "1.5px solid rgba(27,107,184,0.28)",
                        background: "linear-gradient(160deg, #f0f8ff 0%, #f8f6ff 100%)",
                        boxShadow: "0 12px 40px rgba(27,107,184,0.18), 0 4px 12px rgba(0,0,0,0.1)",
                        padding: "10px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "11px", fontWeight: 700, color: "#1b6bb8",
                          textTransform: "uppercase", letterSpacing: "0.07em",
                          padding: "0 4px 8px 4px",
                          borderBottom: "1px solid rgba(27,107,184,0.12)",
                          marginBottom: "8px",
                        }}
                      >
                        Select question type
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {QUESTION_TYPE_OPTIONS.map((t) => {
                          const active = editingQuestion.type === t.id;
                          const enabled = ENABLED_QUESTION_TYPES.has(t.id);
                          const meta = questionTypeMeta(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              disabled={!enabled}
                              title={enabled ? `Use ${meta.label}` : `${meta.label} - Coming soon`}
                              style={{
                                borderRadius: "9px",
                                border: active
                                  ? "1.5px solid #1b6bb8"
                                  : enabled
                                  ? "1px solid rgba(27,107,184,0.15)"
                                  : "1px solid rgba(0,0,0,0.07)",
                                background: active
                                  ? "linear-gradient(135deg, rgba(27,107,184,0.12) 0%, rgba(27,107,184,0.05) 100%)"
                                  : enabled
                                  ? "#ffffff"
                                  : "rgba(0,0,0,0.04)",
                                padding: "8px 12px",
                                textAlign: "left",
                                display: "flex",
                                alignItems: "center",
                                gap: "10px",
                                cursor: enabled ? "pointer" : "not-allowed",
                                opacity: enabled ? 1 : 0.45,
                                boxShadow: active ? "0 2px 8px rgba(27,107,184,0.14)" : "none",
                                transition: "all 150ms",
                              }}
                              onClick={() => {
                                if (!enabled) return;
                                setEditingQuestion((prev) => (prev ? applyQuestionTypeChange(prev, t.id) : prev));
                                setQuestionTypeOpen(false);
                              }}
                            >
                              <span className={cn("h-7 w-7 rounded-md flex items-center justify-center shrink-0", meta.iconWrapClass)}>
                                {meta.icon}
                              </span>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: "13px", color: active ? "#1b6bb8" : enabled ? "#1a1a1a" : "#888" }}>
                                  {meta.label}
                                </div>
                                {!enabled && (
                                  <div style={{ fontSize: "10px", color: "#aaa", fontWeight: 500 }}>Coming soon</div>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap gap-6">
                <Toggle
                  checked={editingQuestion.answer_required}
                  onChange={(v) => setEditingQuestion((prev) => (prev ? { ...prev, answer_required: v } : prev))}
                  label="Answer Required"
                />
                <Toggle
                  checked={editingQuestion.randomize}
                  onChange={(v) => setEditingQuestion((prev) => (prev ? { ...prev, randomize: v } : prev))}
                  label="Randomize"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <QFieldLabel accent="#1b6bb8">Point(s) for this answer</QFieldLabel>
                  <Input
                    className={cn(focusField)}
                    type="number"
                    min={0}
                    max={999}
                    value={editingQuestion.points}
                    onChange={(e) => setEditingQuestion((prev) => (prev ? { ...prev, points: clampInt(Number(e.target.value || 0), 0, 999) } : prev))}
                  />
                </div>
                <div className="flex items-end">
                  <Toggle
                    checked={editingQuestion.display_points}
                    onChange={(v) => setEditingQuestion((prev) => (prev ? { ...prev, display_points: v } : prev))}
                    label="Display Points"
                  />
                </div>
              </div>

              <div>
                <QFieldLabel accent="#1b6bb8">Description (Optional)</QFieldLabel>
                <div>
                  <RichTextEditorWithUploads
                    value={editingQuestion.description_html}
                    onChange={(html) => setEditingQuestion((prev) => (prev ? { ...prev, description_html: html } : prev))}
                    placeholder="Add more context for this question..."
                    minHeightClass="min-h-[160px]"
                    className={focusWithinField}
                    queue={queuedInlineImages}
                    setQueue={setQueuedInlineImages}
                  />
                </div>
              </div>

              <div className="space-y-3">
                {editingQuestion.type === "true_false" ? (
                  <>
                    <QFieldLabel accent="#1b6bb8">Correct answer</QFieldLabel>
                    <TrueFalseCorrectSelector
                      value={typeof editingQuestion.correct_boolean === "boolean" ? editingQuestion.correct_boolean : true}
                      onChange={(v) => setEditingQuestion((prev) => (prev ? { ...prev, correct_boolean: v } : prev))}
                    />
                  </>
                ) : !isSupportedAnswerType(editingQuestion.type) ? (
                  <div className="rounded-md border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                    This question type will be implemented later. For now, use True/False, Single choice, or Multiple Choice.
                  </div>
                ) : (
                  <>
                    <QFieldLabel accent="#1b6bb8">Input options for the question and select the correct answer.</QFieldLabel>

                    <div className="rounded-lg border bg-background p-3 space-y-3">
                      {editingQuestion.options.length ? (
                        <DndContext
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragEnd={(event: DragEndEvent) => {
                            const { active, over } = event;
                            if (!over || active.id === over.id) return;
                            setEditingQuestion((prev) => {
                              if (!prev) return prev;
                              const ordered = prev.options.slice().sort((a, b) => a.position - b.position);
                              const oldIndex = ordered.findIndex((o) => o.id === active.id);
                              const newIndex = ordered.findIndex((o) => o.id === over.id);
                              if (oldIndex < 0 || newIndex < 0) return prev;
                              const next = ordered.slice();
                              const [moved] = next.splice(oldIndex, 1);
                              next.splice(newIndex, 0, moved);
                              return { ...prev, options: next.map((o, idx) => ({ ...o, position: idx })) };
                            });
                          }}
                        >
                          <SortableContext items={editingQuestion.options.slice().sort((a, b) => a.position - b.position).map((o) => o.id)} strategy={verticalListSortingStrategy}>
                            <div className="space-y-2">
                              {editingQuestion.options
                                .slice()
                                .sort((a, b) => a.position - b.position)
                                .map((o) => {
                                  const mode = editingQuestion.type === "multiple_choice" ? "multi" : "single";
                                  const selected =
                                    mode === "multi"
                                      ? (editingQuestion.correct_option_ids ?? []).includes(o.id)
                                      : editingQuestion.correct_option_id === o.id;
                                  return (
                                    <SortableOptionRow
                                      key={o.id}
                                      option={o}
                                      selectionMode={mode}
                                      selected={selected}
                                      isEditing={optionEditorId === o.id}
                                      onCloseEdit={() => setOptionEditorId(null)}
                                      onToggleSelected={() =>
                                        setEditingQuestion((prev) => {
                                          if (!prev) return prev;
                                          if (prev.type === "multiple_choice") {
                                            const set = new Set(prev.correct_option_ids ?? []);
                                            if (set.has(o.id)) set.delete(o.id);
                                            else set.add(o.id);
                                            const arr = [...set];
                                            return { ...prev, correct_option_ids: arr, correct_option_id: arr[0] ?? null };
                                          }
                                          return { ...prev, correct_option_id: o.id, correct_option_ids: [o.id] };
                                        })
                                      }
                                      onEdit={() => setOptionEditorId(o.id)}
                                      onDelete={() =>
                                        setEditingQuestion((prev) => {
                                          if (!prev) return prev;
                                          const filtered = prev.options.filter((x) => x.id !== o.id);
                                          const nextCorrectIds = (prev.correct_option_ids ?? []).filter((id) => id !== o.id);
                                          const nextCorrectId = prev.correct_option_id === o.id ? (nextCorrectIds[0] ?? null) : prev.correct_option_id;
                                          return {
                                            ...prev,
                                            correct_option_id: nextCorrectId,
                                            correct_option_ids: nextCorrectIds,
                                            options: filtered.map((x, idx) => ({ ...x, position: idx })),
                                          };
                                        })
                                      }
                                    >
                                      {/* Body rendered only when editing — becomes the card body */}
                                      <div>
                                        <QFieldLabel accent="#1b6bb8">Answer</QFieldLabel>
                                        <Input
                                          className={cn(focusField)}
                                          value={editingQuestion.options.find((x) => x.id === o.id)?.title ?? ""}
                                          onChange={(e) =>
                                            setEditingQuestion((prev) => {
                                              if (!prev) return prev;
                                              return {
                                                ...prev,
                                                options: prev.options.map((x) => (x.id === o.id ? { ...x, title: e.target.value } : x)),
                                              };
                                            })
                                          }
                                          placeholder="Type answer text"
                                        />
                                      </div>

                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                          <QFieldLabel accent="#7c3abd">Option Image</QFieldLabel>
                                          <div
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => fileInputRef.current?.click()}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter" || e.key === " ") {
                                                e.preventDefault();
                                                fileInputRef.current?.click();
                                              }
                                            }}
                                            onDragOver={(e) => {
                                              e.preventDefault();
                                              setIsOptionImageDragActive(true);
                                            }}
                                            onDragLeave={() => setIsOptionImageDragActive(false)}
                                            onDrop={(e) => {
                                              e.preventDefault();
                                              setIsOptionImageDragActive(false);
                                              const f = e.dataTransfer.files?.[0] ?? null;
                                              if (f) void uploadOptionImage(f);
                                            }}
                                            className={cn(
                                              "h-[180px] cursor-pointer rounded-md border border-dashed flex items-center justify-center overflow-hidden bg-muted/10 transition-colors",
                                              isOptionImageDragActive ? "border-primary bg-primary/5" : "",
                                              "focus:outline-none focus-visible:ring-0"
                                            )}
                                          >
                                            {editingQuestion.options.find((x) => x.id === o.id)?.image_data_url ? (
                                              // eslint-disable-next-line @next/next/no-img-element
                                              <img
                                                src={editingQuestion.options.find((x) => x.id === o.id)?.image_data_url as string}
                                                alt="Option image preview"
                                                className="h-full w-full object-cover"
                                              />
                                            ) : (
                                              <div className="px-3 text-center">
                                                <div className="mx-auto mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-background/80 text-muted-foreground ring-1 ring-border">
                                                  <ImageIcon className="h-5 w-5" />
                                                </div>
                                                <p className="text-xs text-muted-foreground">Drop or choose image</p>
                                                <p className="mt-1 text-[11px] text-muted-foreground">Click here or drag file into this area</p>
                                              </div>
                                            )}
                                          </div>
                                          <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(e) => {
                                              const f = e.target.files?.[0] ?? null;
                                              if (f) void uploadOptionImage(f);
                                              if (fileInputRef.current) fileInputRef.current.value = "";
                                            }}
                                          />
                                          <div className="mt-2 text-xs text-muted-foreground">Recommended: 700x430 pixels</div>
                                        </div>
                                        <div>
                                          <QFieldLabel accent="#7c3abd">Display format for options</QFieldLabel>
                                          <div className="mt-2 space-y-2 text-sm">
                                            {(
                                              [
                                                ["only_text", "Only text"],
                                                ["only_image", "Only Image"],
                                                ["text_and_image_both", "Text & Image both"],
                                              ] as Array<[QuizOptionDisplayFormat, string]>
                                            ).map(([id, label]) => {
                                              const current =
                                                editingQuestion.options.find((x) => x.id === o.id)?.display_format ?? "only_text";
                                              return (
                                                <label key={id} className="flex items-center gap-2">
                                                  <input
                                                    type="radio"
                                                    name={`display_format_${o.id}`}
                                                    checked={current === id}
                                                    onChange={() =>
                                                      setEditingQuestion((prev) => {
                                                        if (!prev) return prev;
                                                        return {
                                                          ...prev,
                                                          options: prev.options.map((x) => (x.id === o.id ? { ...x, display_format: id } : x)),
                                                        };
                                                      })
                                                    }
                                                  />
                                                  {label}
                                                </label>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      </div>
                                    </SortableOptionRow>
                                  );
                                })}
                            </div>
                          </SortableContext>
                        </DndContext>
                      ) : (
                        <p className="text-xs text-muted-foreground">No answers yet. Add at least two answers and mark the correct one.</p>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          const id = makeId("opt");
                          setEditingQuestion((prev) => {
                            if (!prev) return prev;
                            const next: QuizOption = {
                              id,
                              title: "",
                              image_data_url: null,
                              display_format: "only_text",
                              position: prev.options.length,
                            };
                            return { ...prev, options: [...prev.options, next] };
                          });
                          setOptionEditorId(id);
                        }}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: "8px",
                          borderRadius: "9px",
                          border: "1.5px solid rgba(27,107,184,0.25)",
                          background: "rgba(27,107,184,0.04)",
                          padding: "7px 14px",
                          fontSize: "12px", fontWeight: 700, color: "#1b6bb8",
                          cursor: "pointer",
                          boxShadow: "0 1px 4px rgba(27,107,184,0.08)",
                          transition: "all 150ms",
                        }}
                      >
                        <span style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          width: 20, height: 20, borderRadius: "5px",
                          background: "linear-gradient(135deg, #1b6bb8, #144a8a)",
                          boxShadow: "0 2px 5px rgba(27,107,184,0.3)",
                          flexShrink: 0,
                        }}>
                          <Plus className="h-3 w-3 text-white" />
                        </span>
                        Add an Option
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div>
                <QFieldLabel accent="#1b6bb8">Would you like to show answer explanations after the quiz?</QFieldLabel>
                <div className="space-y-2">
                  {(
                    [
                      ["all", "Show all explanations", "Learners will see explanations for every question after the quiz."],
                      ["none", "Show none", "No explanations are shown — learners only see their score."],
                      ["correct_only", "Show only correct-answer explanation", "Explanations shown only when a learner answered correctly."],
                      ["incorrect_only", "Show only incorrect-answer explanation", "Explanations shown only when a learner answered incorrectly."],
                    ] as Array<["all" | "none" | "correct_only" | "incorrect_only", string, string]>
                  ).map(([id, label, desc]) => {
                    const active = (editingQuestion.answer_explanation_mode ?? "none") === id;
                    return (
                    <label
                      key={id}
                      style={{
                        display: "flex", alignItems: "flex-start", gap: "12px",
                        borderRadius: "10px",
                        border: active ? "1.5px solid #1b6bb8" : "1px solid rgba(0,0,0,0.09)",
                        background: active
                          ? "linear-gradient(135deg, rgba(27,107,184,0.09) 0%, rgba(124,58,189,0.05) 100%)"
                          : "#fafafa",
                        padding: "11px 14px",
                        cursor: "pointer",
                        transition: "all 160ms",
                        boxShadow: active ? "0 2px 10px rgba(27,107,184,0.13)" : "none",
                      }}
                    >
                      <input
                        type="radio"
                        name="answer_explanation_mode"
                        style={{ marginTop: "3px", accentColor: "#1b6bb8", flexShrink: 0 }}
                        checked={active}
                        onChange={() =>
                          setEditingQuestion((prev) => {
                            if (!prev) return prev;
                            const mode = id;
                            return {
                              ...prev,
                              answer_explanation_mode: mode,
                              answer_explanation_html: composeAnswerExplanationHtml(
                                mode,
                                prev.answer_explanation_correct_html ?? "",
                                prev.answer_explanation_incorrect_html ?? ""
                              ),
                            };
                          })
                        }
                      />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "13px", color: active ? "#1b6bb8" : "#1a1a1a" }}>{label}</div>
                        <div style={{ fontSize: "11px", color: "#777", marginTop: "2px" }}>{desc}</div>
                      </div>
                    </label>
                    );
                  })}
                </div>

                {(editingQuestion.answer_explanation_mode ?? "none") === "all" || (editingQuestion.answer_explanation_mode ?? "none") === "correct_only" ? (
                  <div className="mt-3">
                    <QFieldLabel accent="#1b6bb8">Correct-answer explanation</QFieldLabel>
                    <div>
                      <RichTextEditorWithUploads
                        value={editingQuestion.answer_explanation_correct_html ?? ""}
                        onChange={(html) =>
                          setEditingQuestion((prev) => {
                            if (!prev) return prev;
                            const mode = prev.answer_explanation_mode ?? "none";
                            const nextCorrect = html;
                            return {
                              ...prev,
                              answer_explanation_correct_html: nextCorrect,
                              answer_explanation_html: composeAnswerExplanationHtml(mode, nextCorrect, prev.answer_explanation_incorrect_html ?? ""),
                            };
                          })
                        }
                        placeholder="Write explanation shown when learner gets this question correct..."
                        minHeightClass="min-h-[160px]"
                        className={focusWithinField}
                        queue={queuedInlineImages}
                        setQueue={setQueuedInlineImages}
                      />
                    </div>
                  </div>
                ) : null}

                {(editingQuestion.answer_explanation_mode ?? "none") === "all" || (editingQuestion.answer_explanation_mode ?? "none") === "incorrect_only" ? (
                  <div className="mt-3">
                    <QFieldLabel accent="#1b6bb8">Incorrect-answer explanation</QFieldLabel>
                    <div>
                      <RichTextEditorWithUploads
                        value={editingQuestion.answer_explanation_incorrect_html ?? ""}
                        onChange={(html) =>
                          setEditingQuestion((prev) => {
                            if (!prev) return prev;
                            const mode = prev.answer_explanation_mode ?? "none";
                            const nextIncorrect = html;
                            return {
                              ...prev,
                              answer_explanation_incorrect_html: nextIncorrect,
                              answer_explanation_html: composeAnswerExplanationHtml(mode, prev.answer_explanation_correct_html ?? "", nextIncorrect),
                            };
                          })
                        }
                        placeholder="Write explanation shown when learner gets this question incorrect..."
                        minHeightClass="min-h-[160px]"
                        className={focusWithinField}
                        queue={queuedInlineImages}
                        setQueue={setQueuedInlineImages}
                      />
                    </div>
                  </div>
                ) : null}
                <div className="mt-2 text-xs text-muted-foreground">
                  Existing learner flow still uses the saved explanation content. This mode controls which explanation content is composed and saved.
                </div>
              </div>

              {/* Primary save action moved to the sticky footer so users don't have to scroll */}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div
            style={{
              borderRadius: "14px",
              border: "1px solid rgba(27,135,85,0.1)",
              background: "#ffffff",
              padding: "16px",
              boxShadow: "0 3px 14px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 28, height: 28, borderRadius: "8px",
                background: "linear-gradient(135deg, #1b8755, #0e4d2c)",
                boxShadow: "0 2px 8px rgba(27,135,85,0.3)",
                flexShrink: 0,
              }}>
                <Timer className="h-4 w-4 text-white" />
              </span>
              <span style={{ fontWeight: 700, fontSize: "13px", color: "#1a1a1a", letterSpacing: "0.01em" }}>
                Time Limit
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input
                type="number"
                min={0}
                max={9999}
                className={cn(focusField)}
                value={settings.time_limit_value}
                onChange={(e) => setSettings((prev) => ({ ...prev, time_limit_value: clampInt(Number(e.target.value || 0), 0, 9999) }))}
              />
              <select
                className={cn(selectBase, selectFocus)}
                value={settings.time_limit_unit}
                onChange={(e) => setSettings((prev) => ({ ...prev, time_limit_unit: e.target.value as QuizTimeUnit }))}
              >
                <option value="seconds">Seconds</option>
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
              </select>
              <div className="flex items-center">
                <Toggle
                  checked={settings.hide_quiz_time_display}
                  onChange={(v) => setSettings((prev) => ({ ...prev, hide_quiz_time_display: v }))}
                  label="Hide quiz time - display"
                />
              </div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">0 means no time limit.</div>
          </div>

          <div
            style={{
              borderRadius: "14px",
              border: "1px solid rgba(27,107,184,0.12)",
              background: "#ffffff",
              padding: "16px",
              boxShadow: "0 3px 14px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "4px", color: "#1a1a1a" }}>👁️ Answer visibility</div>
            <div className="text-xs text-muted-foreground mb-3">Choose when learners should see quiz answers and feedback.</div>
            <div className="space-y-2">
            {(
              [
                ["default", "After quiz finished", "Learners see the answer feedback after all questions are submitted."],
                ["reveal", "After each question", "Learners see answer feedback immediately after each submitted question."],
              ] as Array<[QuizFeedbackMode, string, string]>
            ).map(([id, label, desc]) => {
              const active = settings.feedback_mode === id;
              return (
                <label
                  key={id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    borderRadius: "10px",
                    border: active ? "1.5px solid #1b6bb8" : "1px solid rgba(0,0,0,0.09)",
                    background: active
                      ? "linear-gradient(135deg, rgba(27,107,184,0.10) 0%, rgba(27,107,184,0.04) 100%)"
                      : "#fafafa",
                    padding: "12px 14px",
                    cursor: "pointer",
                    transition: "all 160ms",
                    boxShadow: active ? "0 3px 12px rgba(27,107,184,0.15)" : "none",
                  }}
                >
                  <input
                    type="radio"
                    name="feedback_mode"
                    checked={active}
                    onChange={() => setSettings((prev) => ({ ...prev, feedback_mode: id }))}
                    style={{ marginTop: "2px", accentColor: "#1b6bb8" }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "13px", color: active ? "#1b6bb8" : "#1a1a1a" }}>{label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                  </div>
                </label>
              );
            })}
            </div>
          </div>

          <div
            style={{
              borderRadius: "14px",
              border: "1px solid rgba(124,58,189,0.12)",
              background: "#ffffff",
              padding: "16px",
              boxShadow: "0 3px 14px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "4px", color: "#1a1a1a" }}>🔁 Attempts policy</div>
            <div className="text-xs text-muted-foreground mb-3">Control how many times a learner can retry this quiz.</div>
            <div className="space-y-2">
            {(
              [
                ["single", "Single attempt", "Allow exactly one attempt."],
                ["limited", "Limited attempts", "Allow a limited number of attempts that you choose."],
                ["unlimited", "Unlimited attempts", "Allow unlimited retries."],
              ] as Array<["single" | "limited" | "unlimited", string, string]>
            ).map(([id, label, desc]) => {
              const attemptsMode = attemptsAllowedSafe === 0 ? "unlimited" : attemptsAllowedSafe === 1 ? "single" : "limited";
              const active = attemptsMode === id;
              return (
                <label
                  key={id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    borderRadius: "10px",
                    border: active ? "1.5px solid #7c3abd" : "1px solid rgba(0,0,0,0.09)",
                    background: active
                      ? "linear-gradient(135deg, rgba(124,58,189,0.10) 0%, rgba(124,58,189,0.04) 100%)"
                      : "#fafafa",
                    padding: "12px 14px",
                    cursor: "pointer",
                    transition: "all 160ms",
                    boxShadow: active ? "0 3px 12px rgba(124,58,189,0.15)" : "none",
                  }}
                >
                  <input
                    type="radio"
                    name="attempts_mode"
                    checked={active}
                    onChange={() =>
                      setSettings((prev) => ({
                        ...prev,
                        attempts_allowed: id === "unlimited" ? 0 : id === "single" ? 1 : Math.max(2, prev.attempts_allowed || 2),
                      }))
                    }
                    style={{ marginTop: "2px", accentColor: "#7c3abd" }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "13px", color: active ? "#7c3abd" : "#1a1a1a" }}>{label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                  </div>
                </label>
              );
            })}

            <div className={cn((attemptsAllowedSafe === 0 || attemptsAllowedSafe === 1) && "opacity-60")}>
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="range"
                  min={2}
                  max={10}
                  value={attemptsAllowedSafe > 1 ? attemptsAllowedSafe : 2}
                  disabled={attemptsAllowedSafe === 0 || attemptsAllowedSafe === 1}
                  onChange={(e) => setSettings((prev) => ({ ...prev, attempts_allowed: clampInt(Number(e.target.value || 2), 2, 10) }))}
                  className="w-full"
                  style={{ accentColor: "#7c3abd" }}
                />
                <div
                  style={{
                    width: 38, height: 34, borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 700, fontSize: "14px",
                    background: "linear-gradient(135deg, #7c3abd, #5a2491)",
                    color: "#fff",
                    boxShadow: "0 2px 8px rgba(124,58,189,0.3)",
                  }}
                >
                  {attemptsAllowedSafe > 1 ? attemptsAllowedSafe : "-"}
                </div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">Use this slider only when Limited attempts is selected.</div>
            </div>
            </div>
          </div>

          <div
            style={{
              borderRadius: "14px",
              border: "1px solid rgba(27,135,85,0.12)",
              background: "#ffffff",
              padding: "16px",
              boxShadow: "0 3px 14px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "14px", color: "#1a1a1a" }}>📊 Scoring & Question Pool</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <QFieldLabel accent="#1b8755">Passing Grade (%)</QFieldLabel>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={passingGradePercentInput}
                  className={cn(focusField)}
                  onChange={(e) => {
                    const next = sanitizePercentIntText(e.target.value);
                    setPassingGradePercentInput(next);
                    setSettings((prev) => ({ ...prev, passing_grade_percent: coercePercentInt(next) }));
                  }}
                  onBlur={() => {
                    if (!passingGradePercentInput.trim()) {
                      setPassingGradePercentInput("0");
                      setSettings((prev) => ({ ...prev, passing_grade_percent: 0 }));
                      return;
                    }
                    const next = sanitizePercentIntText(passingGradePercentInput);
                    setPassingGradePercentInput(next || "0");
                    setSettings((prev) => ({ ...prev, passing_grade_percent: coercePercentInt(next) }));
                  }}
                />
                <div className="mt-1 text-xs text-muted-foreground">Set the passing percentage for this quiz</div>
              </div>
              <div>
                <QFieldLabel accent="#1b8755">Max Question Allowed to Answer</QFieldLabel>
                <Input
                  className={cn(focusField)}
                  type="number"
                  min={1}
                  max={500}
                  value={settings.max_questions_allowed_to_answer}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, max_questions_allowed_to_answer: clampInt(Number(e.target.value || 10), 1, 500) }))
                  }
                />
                <div className="mt-1 text-xs text-muted-foreground">
                  This defines how many questions a learner must answer in one attempt. Questions are selected randomly from the quiz pool. If this number is greater than the available questions, all questions are shown.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-1000 bg-black/60 p-4 sm:p-6 overflow-y-auto" data-leave-guard-ignore="true">
      <div className="min-h-[calc(100svh-2rem)] sm:min-h-[calc(100svh-3rem)] flex items-center justify-center">
        <div
          className="w-full max-w-4xl overflow-hidden"
          style={{
            borderRadius: "20px",
            boxShadow: "0 24px 64px rgba(0,0,0,0.22), 0 8px 24px rgba(0,0,0,0.12)",
            border: "1px solid rgba(27,135,85,0.15)",
            background: "#fff",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 20px",
              background: "linear-gradient(135deg, #1b8755 0%, #0e4d2c 100%)",
              borderBottom: "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#fff" }}>
              <ClipboardList className="h-5 w-5" />
              <h3 style={{ fontWeight: 700, fontSize: "16px" }}>Quiz Builder</h3>
            </div>
            <button
              type="button"
              onClick={() => requestExit("close")}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 32, height: 32, borderRadius: "8px",
                background: "rgba(255,255,255,0.2)",
                border: "1px solid rgba(255,255,255,0.25)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <Stepper step={step} />

          {content}

          {confirmExitOpen ? (
            <div className="fixed inset-0 z-1100 bg-black/50 p-4 sm:p-6 overflow-y-auto" data-leave-guard-ignore="true">
              <div className="min-h-[calc(100svh-2rem)] sm:min-h-[calc(100svh-3rem)] flex items-center justify-center">
                <div className="w-full max-w-lg rounded-lg border bg-card shadow-xl">
                  <div className="border-b px-4 py-3">
                    <h3 className="font-semibold">Discard changes?</h3>
                  </div>
                  <div className="p-4 space-y-2 text-sm text-muted-foreground">
                    <p>
                      You have unsaved changes in this question.
                    </p>
                    <p>
                      If you leave now, those changes will be lost.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2 border-t px-4 py-3">
                    <Button type="button" variant="outline" onClick={() => setConfirmExitOpen(false)}>
                      Continue editing
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        const action = pendingExitActionRef.current;
                        pendingExitActionRef.current = null;
                        setConfirmExitOpen(false);
                        if (action === "close") closeAndCleanup();
                        else if (action === "back") goBack();
                      }}
                    >
                      Discard
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderTop: "1px solid rgba(27,135,85,0.1)",
              padding: "14px 20px",
              background: "linear-gradient(135deg, #f0faf6 0%, #e8f5ed 100%)",
            }}
          >
            <Button type="button" variant="outline" onClick={() => requestExit("close")}>
              Cancel
            </Button>

            <div className="flex items-center gap-2">
              {step > 1 ? (
                <Button type="button" variant="outline" onClick={() => requestExit("back")}>
                  Back
                </Button>
              ) : null}

              {editingQuestion ? (
                <Button type="button" className="gap-2" onClick={commitEditingQuestion}>
                  <Plus className="h-4 w-4" />
                  Add to Questions
                </Button>
              ) : step < 3 ? (
                <Button type="button" onClick={goNext}>
                  Save & Next
                </Button>
              ) : (
                <Button type="button" onClick={finalizeSave}>
                  Save
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

