"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Award,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Image as ImageIcon,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  GripVertical,
  Loader2,
  Pencil,
  Paperclip,
  Plus,
  Save,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, fetchJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import { normalizeSlug } from "@/lib/courses/v2.shared";
import { supabase } from "@/lib/supabase/client";
import { generateSupportId } from "@/lib/support/supportId";
import {
  ACCESS_DURATION_KEYS,
  accessKeyLabel,
  computeAccessExpiresAt,
  type AccessDurationKey,
  isAccessDurationKey,
} from "@/lib/courseAssignments/access";
import { RichTextEditorWithUploads } from "@/features/courses/components/v2/RichTextEditorWithUploads";
import { QuizWizardModal } from "@/features/courses/components/v2/QuizWizardModal";
import { CertificatePlacementModal, type CertificateNamePlacement } from "@/features/certificates/components/CertificatePlacementModal";
import { coercePercentInt, sanitizePercentIntText } from "@/lib/percentInput";
import {
  extractInlineUploadIdsFromHtml,
  finalizeInlineImagesInHtml,
  pruneQueueByHtml,
  revokeInlineQueueObjectUrls,
  revokeObjectUrlSafe,
  type InlineImageQueue,
} from "@/lib/richtext/inlineImages";

export type MemberOption = {
  id: string;
  label: string;
};

export type CourseTopicItem = {
  id: string;
  item_type: "lesson" | "quiz";
  title: string | null;
  position: number;
  payload_json: Record<string, unknown>;
  is_required?: boolean;
};

export type CourseTopic = {
  id: string;
  title: string;
  summary: string | null;
  position: number;
  items: CourseTopicItem[];
};

export type CourseV2 = {
  id: string;
  title: string | null;
  slug: string | null;
  status: "draft" | "published" | null;
  about_html: string | null;
  excerpt: string | null;
  difficulty_level: "all_levels" | "beginner" | "intermediate" | "expert" | null;
  what_will_learn: string | null;
  total_duration_hours: number | null;
  total_duration_minutes: number | null;
  materials_included: string | null;
  requirements_instructions: string | null;
  intro_video_provider: "html5" | "youtube" | "vimeo" | null;
  intro_video_url: string | null;
  intro_video_storage_path: string | null;
  cover_image_url: string | null;
  permalink?: string;
  assigned_member_ids?: string[];
  assigned_member_access?: Record<string, AccessDurationKey>;
  assigned_member_expires_at?: Record<string, string | null>;
};

type CourseAssignmentCsvPreview = {
  course: { id: string; title: string };
  summary: {
    total_rows: number;
    valid_rows: number;
    invalid_rows: number;
    assign_count: number;
    update_count: number;
    remove_count: number;
    unchanged_count: number;
  };
  valid_rows: Array<{
    row_number: number;
    user_id: string;
    email: string;
    full_name: string;
    assigned: boolean;
    tfa: AccessDurationKey | null;
    action: "assign" | "update" | "remove" | "unchanged";
  }>;
  invalid_rows: Array<{
    row_number: number;
    user_id: string;
    email: string;
    full_name: string;
    error: string;
  }>;
  normalized_rows: Array<{
    user_id: string;
    assigned: boolean;
    tfa: AccessDurationKey | null;
  }>;
};

class StepError extends Error {
  readonly step: string;
  readonly cause: unknown;
  constructor(step: string, cause: unknown) {
    super(step);
    this.name = "StepError";
    this.step = step;
    this.cause = cause;
  }
}

const THUMBNAIL_ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const THUMBNAIL_MAX_BYTES = 10 * 1024 * 1024;
const THUMBNAIL_MAX_WIDTH = 1400;
const THUMBNAIL_MAX_HEIGHT = 860;
const THUMBNAIL_WEBP_QUALITIES = [0.86, 0.78, 0.7];

function fileNameToWebp(name: string): string {
  const base = name.trim().replace(/\.[^.]+$/, "") || "thumbnail";
  return `${base}.webp`;
}

function canvasToWebpBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.type !== "image/webp") {
          reject(new Error("This browser could not convert the thumbnail to WebP."));
          return;
        }
        resolve(blob);
      },
      "image/webp",
      quality
    );
  });
}

function loadImageElement(file: File): Promise<{ image: HTMLImageElement; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, objectUrl });
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read thumbnail image."));
    };
    image.src = objectUrl;
  });
}

async function loadImageForCanvas(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close(),
    };
  }

  const { image, objectUrl } = await loadImageElement(file);
  return {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    cleanup: () => URL.revokeObjectURL(objectUrl),
  };
}

async function convertImageFileToThumbnailWebp(file: File): Promise<File> {
  const image = await loadImageForCanvas(file);
  try {
    const scale = Math.min(1, THUMBNAIL_MAX_WIDTH / image.width, THUMBNAIL_MAX_HEIGHT / image.height);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare thumbnail image.");
    ctx.drawImage(image.source, 0, 0, width, height);

    let bestBlob: Blob | null = null;
    for (const quality of THUMBNAIL_WEBP_QUALITIES) {
      const blob = await canvasToWebpBlob(canvas, quality);
      bestBlob = blob;
      if (blob.size <= THUMBNAIL_MAX_BYTES) break;
    }

    if (!bestBlob || bestBlob.size > THUMBNAIL_MAX_BYTES) {
      throw new Error("Thumbnail is too large after WebP conversion. Please choose a smaller image.");
    }

    return new File([bestBlob], fileNameToWebp(file.name), {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } finally {
    image.cleanup();
  }
}

type SaveResultCourse = {
  id: string;
  slug: string | null;
  status: "draft" | "published" | null;
};

function formatExpiresChip(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

type LessonVideoProvider = "html5" | "youtube" | "vimeo";

type LessonContentBlock = {
  id: string;
  html: string;
};

type LessonModalState = {
  itemType: "lesson";
  mode: "create" | "edit";
  topicId: string;
  itemId: string | null;
  lessonName: string;
  contentBlocks: LessonContentBlock[];
  inlineImages: InlineImageQueue;
  featureImageFile: File | null;
  featureImagePreviewUrl: string | null;
  featureImageStoragePath: string | null;
  videoProvider: LessonVideoProvider;
  videoUrl: string;
  videoFile: File | null;
  videoStoragePath: string | null;
  playbackHours: number;
  playbackMinutes: number;
  attachments: File[];
  existingAttachments: Array<{ file_name: string; storage_path: string; size_bytes?: number | null; mime?: string | null }>;
};

type QuizModalState = {
  itemType: "quiz";
  mode: "create" | "edit";
  topicId: string;
  itemId: string | null;
  title: string;
  summary: string;
  payload_json: Record<string, unknown> | null;
};

type ItemModalState = LessonModalState | QuizModalState;

type PendingLessonUploads = {
  featureImageFile: File | null;
  videoFile: File | null;
  attachments: File[];
  inlineImages: InlineImageQueue;
};

// We intentionally do NOT store visual separators (like <hr>) inside lesson HTML.
// Spacing is handled at render time. This keeps persisted content cleaner and safer.
const LESSON_BLOCK_SEPARATOR = "\n\n";

function joinLessonBlocksHtml(blocks: LessonContentBlock[]): string {
  const parts = blocks.map((b) => (b?.html ?? "").trim()).filter((v) => v.length > 0);
  return parts.join(LESSON_BLOCK_SEPARATOR);
}

function extractLessonBlocksFromPayload(payload: Record<string, unknown>): LessonContentBlock[] {
  const raw = (payload as { content_blocks?: unknown }).content_blocks;
  if (Array.isArray(raw)) {
    const blocks = raw
      .map((v) => (typeof v === "string" ? v : null))
      .filter((v): v is string => typeof v === "string")
      .map((html, idx) => ({ id: `blk_${idx}_${Date.now()}`, html }));
    if (blocks.length) return blocks;
  }

  const fallback = typeof (payload as { content_html?: unknown }).content_html === "string" ? String((payload as { content_html: string }).content_html) : "";
  // Backwards-compat: if older persisted HTML used <hr> separators, split into blocks.
  const parts = fallback
    .split(/<hr\b[^>]*>/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 1) {
    return parts.map((html, idx) => ({ id: `blk_${idx}_${Date.now()}`, html }));
  }
  return [{ id: `blk_0_${Date.now()}`, html: fallback }];
}

function deepClone<T>(value: T): T {
  // Prefer structuredClone when available (handles nested objects safely).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sc = (globalThis as any)?.structuredClone as ((v: unknown) => unknown) | undefined;
  if (typeof sc === "function") return sc(value) as T;
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildMembersSignatureValue(
  defaultAccess: AccessDurationKey,
  selectedIds: Iterable<string>,
  accessById: Record<string, AccessDurationKey>
): string {
  const ids = [...selectedIds].sort();
  const list = ids.map((id) => ({ id, access: accessById[id] ?? defaultAccess }));
  return JSON.stringify({ default_access: defaultAccess, list });
}

function makeTempId(prefix: string): string {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }
}

function makeBlockId(): string {
  return makeTempId("blk");
}

async function fileFromImageDataUrl(dataUrl: string, fallbackName: string): Promise<File | null> {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,/i.exec(dataUrl);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1] ?? "bin";
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  if (!blob.size) return null;
  return new File([blob], `${fallbackName}.${ext}`, { type: mime });
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{children}</p>;
}

function FieldLabel({
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
      <span
        style={{ display: "block", width: 3, height: 16, borderRadius: 2, background: accent, flexShrink: 0 }}
      />
      <span style={{ fontWeight: 700, fontSize: "13px", color: "#1a1a1a", letterSpacing: "0.01em" }}>
        {children}
        {required ? <span aria-hidden="true"> *</span> : null}
      </span>
    </div>
  );
}

const SECTION_META: Record<string, { icon: string; accent: string; headerFrom: string; headerTo: string }> = {
  "Course Info":     { icon: "📋", accent: "#1b8755", headerFrom: "#f0faf6", headerTo: "#e8f5ed" },
  "Video":           { icon: "🎬", accent: "#1b6bb8", headerFrom: "#f0f6ff", headerTo: "#e8effe" },
  "Course Thumbnail":{ icon: "🖼️", accent: "#7c3abd", headerFrom: "#f8f2ff", headerTo: "#f0eaff" },
  "Course Settings": { icon: "⚙️", accent: "#b87216", headerFrom: "#fffbf0", headerTo: "#fff3dc" },
  "Course Builder":  { icon: "🏗️", accent: "#0e4d2c", headerFrom: "#e8f5ed", headerTo: "#d5eddf" },
  "Additional Data": { icon: "📂", accent: "#1e6b8c", headerFrom: "#f0faff", headerTo: "#e2f4fc" },
  "Certificate":     { icon: "🏆", accent: "#1b8755", headerFrom: "#f0faf6", headerTo: "#e8f5ed" },
};

function DetailsSection({
  title,
  defaultOpen = true,
  allowOverflow = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  allowOverflow?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = SECTION_META[title] ?? { icon: "📄", accent: "#1b8755", headerFrom: "#f0faf6", headerTo: "#e8f5ed" };

  return (
    <div
      style={{
        borderRadius: "16px",
        overflow: allowOverflow ? "visible" : "hidden",
        boxShadow: "0 4px 24px rgba(0,0,0,0.07), 0 1px 4px rgba(0,0,0,0.04)",
        border: `1px solid ${meta.accent}22`,
        background: "#ffffff",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          background: `linear-gradient(135deg, ${meta.headerFrom} 0%, ${meta.headerTo} 100%)`,
          borderBottom: open ? `1px solid ${meta.accent}18` : "none",
          cursor: "pointer",
          textAlign: "left",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              borderRadius: "8px",
              background: `${meta.accent}18`,
              fontSize: "16px",
              flexShrink: 0,
            }}
          >
            {meta.icon}
          </span>
          <h2 style={{ fontWeight: 700, fontSize: "14px", color: "#1a1a1a", letterSpacing: "0.01em" }}>
            {title}
          </h2>
        </div>
        <ChevronDown
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 220ms ease",
            color: meta.accent,
            width: 18,
            height: 18,
            flexShrink: 0,
          }}
        />
      </button>

      {open && (
        <div style={{ padding: "20px 20px" }}>
          {children}
        </div>
      )}
    </div>
  );
}

function hasMeaningfulRichText(html: string): boolean {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= 8;
}

function pruneQueueByHtmlWithRevoke(prevQueue: InlineImageQueue, html: string): InlineImageQueue {
  const prev = prevQueue ?? {};
  const next = pruneQueueByHtml(prev, html);
  for (const id of Object.keys(prev)) {
    if (Object.prototype.hasOwnProperty.call(next, id)) continue;
    revokeObjectUrlSafe(prev[id]?.objectUrl);
  }
  return next;
}

function pruneQueueByBlocksWithRevoke(prevQueue: InlineImageQueue, blocks: LessonContentBlock[]): InlineImageQueue {
  return pruneQueueByHtmlWithRevoke(prevQueue, joinLessonBlocksHtml(blocks));
}

function SortableTopicRow({
  topic,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onAddLesson,
  onAddQuiz,
  onEditLessonItem,
  onEditQuizItem,
  onReorderItems,
  onDeleteItem,
}: {
  topic: CourseTopic;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddLesson: () => void;
  onAddQuiz: () => void;
  onEditLessonItem: (topicId: string, item: CourseTopicItem) => void;
  onEditQuizItem: (topicId: string, item: CourseTopicItem) => void;
  onReorderItems: (topicId: string, orderedItemIds: string[]) => void;
  onDeleteItem: (topicId: string, itemId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: topic.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        borderRadius: "12px",
        border: "1px solid rgba(27,135,85,0.15)",
        background: "#ffffff",
        boxShadow: isDragging ? "0 8px 24px rgba(0,0,0,0.14)" : "0 2px 10px rgba(0,0,0,0.06)",
        overflow: "hidden",
        opacity: isDragging ? 0.75 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          padding: "10px 14px",
          background: "linear-gradient(135deg, #f0faf6 0%, #e8f5ed 100%)",
          borderBottom: "1px solid rgba(27,135,85,0.1)",
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
            aria-label="Move chapter"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{topic.title}</p>
            {topic.summary ? <p className="text-xs text-muted-foreground truncate">{topic.summary}</p> : null}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon-sm" onClick={onEdit} title="Edit chapter">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onDelete} title="Delete chapter">
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onToggle} title={expanded ? "Collapse chapter" : "Expand chapter"}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="px-3 py-3 space-y-3" style={{ background: "#fafffe" }}>
          {topic.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">No content items yet for this chapter.</p>
          ) : (
            <div className="space-y-2">
              <DndContext
                collisionDetection={closestCenter}
                onDragEnd={(event) => {
                  const { active, over } = event;
                  if (!over || active.id === over.id) return;
                  const ordered = topic.items
                    .slice()
                    .sort((a, b) => a.position - b.position)
                    .map((i) => i.id);
                  const oldIndex = ordered.findIndex((id) => id === active.id);
                  const newIndex = ordered.findIndex((id) => id === over.id);
                  if (oldIndex < 0 || newIndex < 0) return;
                  const next = ordered.slice();
                  const [moved] = next.splice(oldIndex, 1);
                  next.splice(newIndex, 0, moved);
                  onReorderItems(topic.id, next);
                }}
              >
                <SortableContext
                  items={topic.items
                    .slice()
                    .sort((a, b) => a.position - b.position)
                    .map((i) => i.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {topic.items
                      .slice()
                      .sort((a, b) => a.position - b.position)
                      .map((item) => (
                        <SortableTopicItemRow
                          key={item.id}
                          topicId={topic.id}
                          item={item}
                          onEditLessonItem={onEditLessonItem}
                          onEditQuizItem={onEditQuizItem}
                          onDeleteItem={onDeleteItem}
                        />
                      ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onAddLesson}>
              <Plus className="h-4 w-4" />
              Lesson
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onAddQuiz}>
              <Plus className="h-4 w-4" />
              Quiz
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SortableTopicItemRow({
  topicId,
  item,
  onEditLessonItem,
  onEditQuizItem,
  onDeleteItem,
}: {
  topicId: string;
  item: CourseTopicItem;
  onEditLessonItem: (topicId: string, item: CourseTopicItem) => void;
  onEditQuizItem: (topicId: string, item: CourseTopicItem) => void;
  onDeleteItem: (topicId: string, itemId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isLesson = item.item_type === "lesson";
  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderRadius: "9px",
        border: isLesson ? "1px solid rgba(27,107,184,0.18)" : "1px solid rgba(124,58,189,0.18)",
        borderLeft: isLesson ? "3px solid #1b6bb8" : "3px solid #7c3abd",
        background: "#ffffff",
        padding: "8px 12px",
        boxShadow: isDragging ? "0 6px 18px rgba(0,0,0,0.12)" : "0 1px 4px rgba(0,0,0,0.05)",
        opacity: isDragging ? 0.75 : 1,
        gap: "8px",
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
          aria-label="Move item"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <p className="text-sm font-medium truncate">{item.title?.trim() || "(untitled)"}</p>
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.06em",
            padding: "2px 7px",
            borderRadius: "99px",
            background: isLesson ? "rgba(27,107,184,0.1)" : "rgba(124,58,189,0.1)",
            color: isLesson ? "#1b6bb8" : "#7c3abd",
            textTransform: "uppercase",
          }}
        >
          {item.item_type}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {item.item_type === "lesson" ? (
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => onEditLessonItem(topicId, item)} title="Edit lesson">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => onEditQuizItem(topicId, item)} title="Edit quiz">
            <Pencil className="h-4 w-4" />
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => onDeleteItem(topicId, item.id)} title="Delete item">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function SortableLessonContentBlockRow({
  block,
  index,
  onChangeHtml,
  onRemove,
  queue,
  setQueue,
}: {
  block: LessonContentBlock;
  index: number;
  onChangeHtml: (nextHtml: string) => void;
  onRemove: () => void;
  queue: InlineImageQueue;
  setQueue: (next: InlineImageQueue | ((prev: InlineImageQueue) => InlineImageQueue)) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        borderRadius: "12px",
        border: "1px solid rgba(27,107,184,0.18)",
        background: "#ffffff",
        boxShadow: isDragging
          ? "0 8px 32px rgba(27,107,184,0.18)"
          : "0 2px 10px rgba(0,0,0,0.06)",
        overflow: "hidden",
        opacity: isDragging ? 0.75 : 1,
        transition: "box-shadow 200ms, opacity 200ms",
      }}
    >
      {/* Styled header matching section-card pattern */}
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: "8px",
          padding: "9px 12px",
          background: "linear-gradient(135deg, #f0f6ff 0%, #e8effe 100%)",
          borderBottom: "1px solid rgba(27,107,184,0.12)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          {/* Drag handle */}
          <button
            type="button"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 28, height: 28, borderRadius: "7px",
              background: "rgba(27,107,184,0.1)",
              color: "#1b6bb8",
              cursor: "grab",
              border: "none",
              flexShrink: 0,
            }}
            title="Drag to reorder"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>

          {/* Block icon badge */}
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 26, height: 26, borderRadius: "7px",
            background: "linear-gradient(135deg, #1b6bb8, #144a8a)",
            boxShadow: "0 2px 6px rgba(27,107,184,0.3)",
            fontSize: "13px",
            flexShrink: 0,
          }}>
            📝
          </span>

          <span style={{ fontWeight: 700, fontSize: "12px", color: "#1b6bb8", letterSpacing: "0.01em" }}>
            Content block {index + 1}
          </span>
        </div>

        {/* Remove button */}
        <button
          type="button"
          onClick={onRemove}
          title="Remove content block"
          aria-label="Remove content block"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: "7px",
            background: "rgba(220,38,38,0.08)",
            color: "#dc2626",
            border: "none",
            cursor: "pointer",
            flexShrink: 0,
            transition: "background 150ms",
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div style={{ padding: "12px" }}>
        <RichTextEditorWithUploads
          value={block.html}
          onChange={onChangeHtml}
          placeholder="Write lesson content here..."
          minHeightClass="min-h-[220px]"
          queue={queue}
          setQueue={setQueue}
        />
      </div>
    </div>
  );
}

function StaticTopicRow({
  topic,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onAddLesson,
  onAddQuiz,
  onEditLessonItem,
  onEditQuizItem,
  onDeleteItem,
}: {
  topic: CourseTopic;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddLesson: () => void;
  onAddQuiz: () => void;
  onEditLessonItem: (topicId: string, item: CourseTopicItem) => void;
  onEditQuizItem: (topicId: string, item: CourseTopicItem) => void;
  onDeleteItem: (topicId: string, itemId: string) => void;
}) {
  return (
    <div
      style={{
        borderRadius: "12px",
        border: "1px solid rgba(27,135,85,0.15)",
        background: "#ffffff",
        boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          padding: "10px 14px",
          background: "linear-gradient(135deg, #f0faf6 0%, #e8f5ed 100%)",
          borderBottom: "1px solid rgba(27,135,85,0.1)",
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-muted-foreground" aria-hidden="true">
            <GripVertical className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{topic.title}</p>
            {topic.summary ? <p className="text-xs text-muted-foreground truncate">{topic.summary}</p> : null}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon-sm" onClick={onEdit} title="Edit chapter">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onDelete} title="Delete chapter">
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onToggle} title={expanded ? "Collapse chapter" : "Expand chapter"}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="px-3 py-3 space-y-3" style={{ background: "#fafffe" }}>
          {topic.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">No content items yet for this chapter.</p>
          ) : (
            <div className="space-y-2">
              {topic.items
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((item) => {
                  const isLesson = item.item_type === "lesson";
                  return (
                    <div
                      key={item.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        borderRadius: "9px",
                        border: isLesson ? "1px solid rgba(27,107,184,0.18)" : "1px solid rgba(124,58,189,0.18)",
                        borderLeft: isLesson ? "3px solid #1b6bb8" : "3px solid #7c3abd",
                        background: "#ffffff",
                        padding: "8px 12px",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
                        gap: "8px",
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm font-medium truncate">{item.title?.trim() || "(untitled)"}</p>
                        <span
                          style={{
                            fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
                            padding: "2px 7px", borderRadius: "99px",
                            background: isLesson ? "rgba(27,107,184,0.1)" : "rgba(124,58,189,0.1)",
                            color: isLesson ? "#1b6bb8" : "#7c3abd",
                            textTransform: "uppercase",
                          }}
                        >
                          {item.item_type}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {item.item_type === "lesson" ? (
                          <Button type="button" variant="ghost" size="icon-sm" onClick={() => onEditLessonItem(topic.id, item)} title="Edit lesson">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button type="button" variant="ghost" size="icon-sm" onClick={() => onEditQuizItem(topic.id, item)} title="Edit quiz">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => onDeleteItem(topic.id, item.id)} title="Delete item">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onAddLesson}>
              <Plus className="h-4 w-4" />
              Lesson
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onAddQuiz}>
              <Plus className="h-4 w-4" />
              Quiz
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CourseEditorV2Form({
  mode,
  orgSlug,
  backHref,
  initialCourse,
  initialTopics,
  memberOptions,
}: {
  mode: "create" | "edit";
  orgSlug: string;
  backHref: string;
  initialCourse: CourseV2 | null;
  initialTopics: CourseTopic[];
  memberOptions: MemberOption[];
}) {
  type MainEditorTab = "information" | "builder";
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  type CertificateTemplateRow = {
    id: string;
    course_id: string;
    storage_bucket: string;
    storage_path: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
  };

  type CertificateSettingsRow = {
    course_id: string;
    organization_id: string;
    enabled: boolean;
    certificate_title: string;
    course_passing_grade_percent: number;
    name_placement_json: CertificateNamePlacement | null;
    updated_at: string;
    updated_by: string | null;
  };

  const [courseId, setCourseId] = useState<string | null>(initialCourse?.id ?? null);
  const [status, setStatus] = useState<"draft" | "published">(initialCourse?.status === "published" ? "published" : "draft");
  const [pendingDeletedTopicIds, setPendingDeletedTopicIds] = useState<string[]>([]);
  const [pendingDeletedItemIds, setPendingDeletedItemIds] = useState<string[]>([]);
  const [pendingLessonUploadsByItemId, setPendingLessonUploadsByItemId] = useState<Record<string, PendingLessonUploads>>({});
  const [leavePrompt, setLeavePrompt] = useState<{ href: string } | null>(null);
  const [confirmUnpublishDraftOpen, setConfirmUnpublishDraftOpen] = useState(false);
  const [deleteCourseOpen, setDeleteCourseOpen] = useState(false);
  const [deleteCourseConfirmText, setDeleteCourseConfirmText] = useState("");
  const [title, setTitle] = useState(initialCourse?.title ?? "");
  const [slug, setSlug] = useState(initialCourse?.slug ?? "");
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(Boolean(initialCourse?.slug?.trim()));
  const [aboutHtml, setAboutHtml] = useState(initialCourse?.about_html ?? "");
  const [pendingCourseAboutInlineImages, setPendingCourseAboutInlineImages] = useState<InlineImageQueue>({});
  const [excerpt, setExcerpt] = useState(initialCourse?.excerpt ?? "");
  const [difficulty, setDifficulty] = useState<CourseV2["difficulty_level"]>(initialCourse?.difficulty_level ?? "all_levels");
  const [whatWillLearn, setWhatWillLearn] = useState(initialCourse?.what_will_learn ?? "");
  const [hours, setHours] = useState<number>(initialCourse?.total_duration_hours ?? 0);
  const [minutes, setMinutes] = useState<number>(initialCourse?.total_duration_minutes ?? 0);
  const [materialsIncluded, setMaterialsIncluded] = useState(initialCourse?.materials_included ?? "");
  const [requirements, setRequirements] = useState(initialCourse?.requirements_instructions ?? "");
  const [videoProvider, setVideoProvider] = useState<"html5" | "youtube" | "vimeo">(initialCourse?.intro_video_provider ?? "html5");
  const [videoUrl, setVideoUrl] = useState(initialCourse?.intro_video_url ?? "");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [isVideoDragActive, setIsVideoDragActive] = useState(false);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState(initialCourse?.cover_image_url ?? "");
  const [thumbnailObjectUrl, setThumbnailObjectUrl] = useState<string | null>(null);
  const [isThumbnailDragActive, setIsThumbnailDragActive] = useState(false);
  const [pendingThumbnailRemoval, setPendingThumbnailRemoval] = useState(false);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const thumbnailPrepareSeqRef = useRef(0);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set(initialCourse?.assigned_member_ids ?? []));
  const [memberDefaultAccess, setMemberDefaultAccess] = useState<AccessDurationKey>("unlimited");
  const [memberAccessById, setMemberAccessById] = useState<Record<string, AccessDurationKey>>(() => {
    const base = initialCourse?.assigned_member_access ?? {};
    const ids = initialCourse?.assigned_member_ids ?? [];
    const out: Record<string, AccessDurationKey> = {};
    for (const id of ids) {
      const raw = (base as Record<string, unknown>)[id];
      out[id] = isAccessDurationKey(raw) ? (raw as AccessDurationKey) : "unlimited";
    }
    return out;
  });
  const [baselineMemberExpiresAtById, setBaselineMemberExpiresAtById] = useState<Record<string, string | null>>(() => {
    const base = initialCourse?.assigned_member_expires_at ?? {};
    const ids = initialCourse?.assigned_member_ids ?? [];
    const out: Record<string, string | null> = {};
    for (const id of ids) {
      const raw = (base as Record<string, unknown>)[id];
      out[id] = typeof raw === "string" ? raw : null;
    }
    return out;
  });
  const memberAccessPreviewEpochMsRef = useRef<number>(Date.now());
  const [membersOpen, setMembersOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const csvImportInputRef = useRef<HTMLInputElement | null>(null);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [csvImportFileName, setCsvImportFileName] = useState<string | null>(null);
  const [csvImportPreview, setCsvImportPreview] = useState<CourseAssignmentCsvPreview | null>(null);
  const [csvPreviewLoading, setCsvPreviewLoading] = useState(false);
  const [csvApplyLoading, setCsvApplyLoading] = useState(false);

  // Certificate (Course Information tab)
  const [certLoading, setCertLoading] = useState(false);
  const [certSaving, setCertSaving] = useState(false);
  const [certTemplate, setCertTemplate] = useState<CertificateTemplateRow | null>(null);
  const [certTitle, setCertTitle] = useState("");
  const [certPassingPercent, setCertPassingPercent] = useState<number>(0);
  const [certPassingPercentInput, setCertPassingPercentInput] = useState<string>("0");
  const [certPlacement, setCertPlacement] = useState<CertificateNamePlacement | null>(null);
  const [certPlacementOpen, setCertPlacementOpen] = useState(false);
  const [certTplFile, setCertTplFile] = useState<File | null>(null);
  const [certTplPreviewUrl, setCertTplPreviewUrl] = useState<string | null>(null);
  const [certTplUploading, setCertTplUploading] = useState(false);
  const [isCertTplDragActive, setIsCertTplDragActive] = useState(false);
  const certTplInputRef = useRef<HTMLInputElement | null>(null);
  const certAutoSaveTimerRef = useRef<number | null>(null);
  const certAutoClearTimerRef = useRef<number | null>(null);
  const [certAutoStatus, setCertAutoStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const [topics, setTopics] = useState<CourseTopic[]>(initialTopics ?? []);
  const [expandedTopicIds, setExpandedTopicIds] = useState<Set<string>>(new Set());

  const [isBusy, setIsBusy] = useState(false);
  type BusyAction = "save_published" | "save_draft" | "publish" | "delete_course";
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const busyActionRef = useRef<BusyAction | null>(null);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [busyVisitedSteps, setBusyVisitedSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorStep, setErrorStep] = useState<string | null>(null);
  const [errorSupportId, setErrorSupportId] = useState<string | null>(null);
  const [errorCanReport, setErrorCanReport] = useState(false);
  const [errorReportPayload, setErrorReportPayload] = useState<Record<string, unknown> | null>(null);
  const [errorReportSending, setErrorReportSending] = useState(false);
  const [errorReportSent, setErrorReportSent] = useState(false);
  const [successModal, setSuccessModal] = useState<{ title: string; description: string } | null>(null);
  const [activeMainTab, setActiveMainTab] = useState<MainEditorTab>("information");
  const [origin, setOrigin] = useState("");
  const [dndReady, setDndReady] = useState(false);

  useEffect(() => {
    if (error !== null) return;
    setErrorStep(null);
    setErrorSupportId(null);
    setErrorCanReport(false);
    setErrorReportPayload(null);
    setErrorReportSending(false);
    setErrorReportSent(false);
  }, [error]);

  const [topicModal, setTopicModal] = useState<{ mode: "create" | "edit"; topicId: string | null; title: string; summary: string } | null>(null);
  const [itemModal, setItemModal] = useState<ItemModalState | null>(null);
  const itemModalType = itemModal?.itemType ?? null;
  const lessonFeatureImageFile = itemModalType === "lesson" ? (itemModal as LessonModalState).featureImageFile : null;

  function ensureAtLeastOneBlock(blocks: LessonContentBlock[]): LessonContentBlock[] {
    if (blocks.length > 0) return blocks;
    return [{ id: makeBlockId(), html: "" }];
  }

  function reorderBlocks(blocks: LessonContentBlock[], activeId: string, overId: string): LessonContentBlock[] {
    const oldIndex = blocks.findIndex((b) => b.id === activeId);
    const newIndex = blocks.findIndex((b) => b.id === overId);
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return blocks;
    const next = blocks.slice();
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    return next;
  }

  function addLessonContentBlock() {
    setItemModal((prev) => {
      if (!prev || prev.itemType !== "lesson") return prev;
      const nextBlocks = [...(prev.contentBlocks ?? []), { id: makeBlockId(), html: "" }];
      return { ...prev, contentBlocks: nextBlocks };
    });
  }

  function removeLessonContentBlock(blockId: string) {
    setItemModal((prev) => {
      if (!prev || prev.itemType !== "lesson") return prev;
      const nextBlocks = ensureAtLeastOneBlock((prev.contentBlocks ?? []).filter((b) => b.id !== blockId));
      const nextInline = pruneQueueByBlocksWithRevoke(prev.inlineImages ?? {}, nextBlocks);
      return { ...prev, contentBlocks: nextBlocks, inlineImages: nextInline };
    });
  }

  function onLessonBlocksDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItemModal((prev) => {
      if (!prev || prev.itemType !== "lesson") return prev;
      const blocks = prev.contentBlocks ?? [];
      const nextBlocks = reorderBlocks(blocks, String(active.id), String(over.id));
      return { ...prev, contentBlocks: nextBlocks };
    });
  }

  const savedSnapshotRef = useRef<{
    courseId: string | null;
    status: "draft" | "published";
    title: string;
    slug: string;
    isSlugManuallyEdited: boolean;
    aboutHtml: string;
    excerpt: string;
    difficulty: CourseV2["difficulty_level"];
    whatWillLearn: string;
    hours: number;
    minutes: number;
    materialsIncluded: string;
    requirements: string;
    videoProvider: "html5" | "youtube" | "vimeo";
    videoUrl: string;
    thumbnailUrl: string;
    selectedMemberIds: string[];
    topics: CourseTopic[];
  }>({
    courseId: initialCourse?.id ?? null,
    status: initialCourse?.status === "published" ? "published" : "draft",
    title: initialCourse?.title ?? "",
    slug: initialCourse?.slug ?? "",
    isSlugManuallyEdited: Boolean(initialCourse?.slug?.trim()),
    aboutHtml: initialCourse?.about_html ?? "",
    excerpt: initialCourse?.excerpt ?? "",
    difficulty: initialCourse?.difficulty_level ?? "all_levels",
    whatWillLearn: initialCourse?.what_will_learn ?? "",
    hours: initialCourse?.total_duration_hours ?? 0,
    minutes: initialCourse?.total_duration_minutes ?? 0,
    materialsIncluded: initialCourse?.materials_included ?? "",
    requirements: initialCourse?.requirements_instructions ?? "",
    videoProvider: (initialCourse?.intro_video_provider ?? "html5") as "html5" | "youtube" | "vimeo",
    videoUrl: initialCourse?.intro_video_url ?? "",
    thumbnailUrl: initialCourse?.cover_image_url ?? "",
    selectedMemberIds: initialCourse?.assigned_member_ids ?? [],
    topics: deepClone(initialTopics ?? []),
  });

  const currentSignature = useMemo(() => {
    const members = [...selectedMemberIds].sort();
    const memberAccessSig = members.map((id) => ({
      id,
      access: memberAccessById[id] ?? memberDefaultAccess,
    }));
    const topicsSig = topics.map((t) => ({
      id: t.id,
      title: t.title,
      summary: t.summary ?? null,
      position: t.position,
      items: (t.items ?? []).map((it) => ({
        id: it.id,
        item_type: it.item_type,
        title: it.title ?? null,
        is_required: Boolean((it as { is_required?: unknown }).is_required),
        position: it.position,
        payload_json: it.payload_json ?? {},
      })),
    }));

    const uploadSig = Object.entries(pendingLessonUploadsByItemId).map(([k, v]) => ({
      k,
      hasFeature: Boolean(v.featureImageFile),
      hasVideo: Boolean(v.videoFile),
      attachmentsCount: v.attachments?.length ?? 0,
      inlineImagesCount: Object.keys(v.inlineImages ?? {}).length,
    }));

    return JSON.stringify({
      courseId,
      status,
      title,
      slug,
      isSlugManuallyEdited,
      aboutHtml,
      excerpt,
      difficulty,
      whatWillLearn,
      hours,
      minutes,
      materialsIncluded,
      requirements,
      videoProvider,
      videoUrl,
      thumbnailUrl,
      members,
      memberDefaultAccess,
      memberAccessSig,
      topicsSig,
      pendingDeletedTopicIds: pendingDeletedTopicIds.slice().sort(),
      pendingDeletedItemIds: pendingDeletedItemIds.slice().sort(),
      uploadSig: uploadSig.sort((a, b) => a.k.localeCompare(b.k)),
      hasIntroVideoFile: Boolean(videoFile),
      hasThumbnailFile: Boolean(thumbnailFile),
    });
  }, [
    aboutHtml,
    courseId,
    difficulty,
    excerpt,
    hours,
    isSlugManuallyEdited,
    materialsIncluded,
    memberAccessById,
    memberDefaultAccess,
    minutes,
    pendingDeletedItemIds,
    pendingDeletedTopicIds,
    pendingLessonUploadsByItemId,
    requirements,
    selectedMemberIds,
    slug,
    status,
    thumbnailFile,
    thumbnailUrl,
    title,
    topics,
    videoFile,
    videoProvider,
    videoUrl,
    whatWillLearn,
  ]);

  const savedSignatureRef = useRef<string>("");
  useEffect(() => {
    if (savedSignatureRef.current) return;
    const snap = savedSnapshotRef.current;
    const members = (snap.selectedMemberIds ?? []).slice().sort();
    const memberAccessSig = members.map((id) => ({
      id,
      access: memberAccessById[id] ?? memberDefaultAccess,
    }));
    savedSignatureRef.current = JSON.stringify({
      courseId: snap.courseId,
      status: snap.status,
      title: snap.title,
      slug: snap.slug,
      isSlugManuallyEdited: snap.isSlugManuallyEdited,
      aboutHtml: snap.aboutHtml,
      excerpt: snap.excerpt,
      difficulty: snap.difficulty,
      whatWillLearn: snap.whatWillLearn,
      hours: snap.hours,
      minutes: snap.minutes,
      materialsIncluded: snap.materialsIncluded,
      requirements: snap.requirements,
      videoProvider: snap.videoProvider,
      videoUrl: snap.videoUrl,
      thumbnailUrl: snap.thumbnailUrl,
      members,
      memberDefaultAccess,
      memberAccessSig,
      topicsSig: (snap.topics ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        summary: t.summary ?? null,
        position: t.position,
        items: (t.items ?? []).map((it) => ({
          id: it.id,
          item_type: it.item_type,
          title: it.title ?? null,
          is_required: Boolean((it as { is_required?: unknown }).is_required),
          position: it.position,
          payload_json: it.payload_json ?? {},
        })),
      })),
      pendingDeletedTopicIds: [],
      pendingDeletedItemIds: [],
      uploadSig: [],
      hasIntroVideoFile: false,
      hasThumbnailFile: false,
    });
  }, [memberAccessById, memberDefaultAccess]);

  const certStateSignature = useCallback((input: {
    title: string;
    passingPercent: number;
    placement: CertificateNamePlacement | null;
    template: CertificateTemplateRow | null;
  }): string => {
    return JSON.stringify({
      title: String(input.title ?? ""),
      passingPercent: Number.isFinite(Number(input.passingPercent)) ? Number(input.passingPercent) : 0,
      placement: input.placement ?? null,
      template: input.template
        ? {
            id: input.template.id,
            storage_bucket: input.template.storage_bucket,
            storage_path: input.template.storage_path,
            file_name: input.template.file_name,
            mime_type: input.template.mime_type,
            size_bytes: input.template.size_bytes,
          }
        : null,
    });
  }, []);

  const certSignature = useMemo(() => {
    return certStateSignature({
      title: certTitle,
      passingPercent: certPassingPercent,
      placement: certPlacement,
      template: certTemplate,
    });
  }, [certPassingPercent, certPlacement, certStateSignature, certTemplate, certTitle]);

  const savedCertSignatureRef = useRef<string>(certSignature);
  const savedCertSnapshotRef = useRef<{
    title: string;
    passingPercent: number;
    placement: CertificateNamePlacement | null;
    template: CertificateTemplateRow | null;
  }>({
    title: certTitle,
    passingPercent: certPassingPercent,
    placement: certPlacement,
    template: certTemplate,
  });

  const hasUnsavedChanges = currentSignature !== savedSignatureRef.current || certSignature !== savedCertSignatureRef.current || certTplUploading;

  // Autosave: every 5 minutes, persist the same pipeline as Save (silent).
  const autosaveCallbackRef = useRef<(() => void) | null>(null);
  const saveDraftRef = useRef(saveDraft);
  const savePublishedRef = useRef(savePublished);
  saveDraftRef.current = saveDraft;
  savePublishedRef.current = savePublished;

  useEffect(() => {
    autosaveCallbackRef.current = () => {
      if (!hasUnsavedChanges) return;
      if (isBusy) return;
      // Avoid creating a draft course without a minimally valid title.
      if (!courseId && title.trim().length < 2) return;
      void (status === "published" ? savePublishedRef.current({ silent: true }) : saveDraftRef.current({ silent: true }));
    };
  }, [courseId, hasUnsavedChanges, isBusy, status, title]);

  useEffect(() => {
    const id = window.setInterval(() => {
      autosaveCallbackRef.current?.();
    }, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    setDndReady(true);
  }, []);

  async function loadCertificateSettingsAndTemplate(courseIdToUse: string) {
    setCertLoading(true);
    try {
      const { data: body } = await fetchJson<{ settings: CertificateSettingsRow | null; template: CertificateTemplateRow | null }>(
        `/api/courses/${courseIdToUse}/certificate-settings`,
        { cache: "no-store" }
      );
      const settings = body.settings ?? null;
      const tpl = body.template ?? null;
      const nextTitle = String(settings?.certificate_title ?? "");
      const nextPassing = Number.isFinite(Number(settings?.course_passing_grade_percent)) ? Number(settings?.course_passing_grade_percent) : 0;
      const nextPlacement = (settings?.name_placement_json as CertificateNamePlacement | null) ?? null;

      // Keep leave-guard baseline aligned with the last persisted certificate state.
      savedCertSnapshotRef.current = {
        title: nextTitle,
        passingPercent: nextPassing,
        placement: nextPlacement,
        template: tpl,
      };
      savedCertSignatureRef.current = certStateSignature({
        title: nextTitle,
        passingPercent: nextPassing,
        placement: nextPlacement,
        template: tpl,
      });
      setCertAutoStatus("idle");

      setCertTemplate(tpl);
      setCertTitle(nextTitle);
      setCertPassingPercent(nextPassing);
      setCertPassingPercentInput(String(nextPassing));
      setCertPlacement(nextPlacement);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load certificate settings.");
    } finally {
      setCertLoading(false);
    }
  }

  async function saveCertificateSettings(courseIdToUse: string, next: Partial<CertificateSettingsRow>, opts?: { silent?: boolean }) {
    setCertSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if (typeof next.certificate_title === "string") payload.certificate_title = next.certificate_title;
      if (typeof next.course_passing_grade_percent === "number") payload.course_passing_grade_percent = next.course_passing_grade_percent;
      if ("name_placement_json" in next) payload.name_placement_json = next.name_placement_json ?? null;

      const { data: body } = await fetchJson<{ settings: CertificateSettingsRow }>(`/api/courses/${courseIdToUse}/certificate-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const s = body.settings;
      const nextTitle = String(s.certificate_title ?? "");
      const nextPassing = Number.isFinite(Number(s.course_passing_grade_percent)) ? Number(s.course_passing_grade_percent) : 0;
      const nextPlacement = (s.name_placement_json as CertificateNamePlacement | null) ?? null;

      setCertTitle(nextTitle);
      setCertPassingPercent(nextPassing);
      setCertPassingPercentInput(String(nextPassing));
      setCertPlacement(nextPlacement);

      // Update certificate baseline (so leave-guard matches the persisted state).
      savedCertSnapshotRef.current = {
        title: nextTitle,
        passingPercent: nextPassing,
        placement: nextPlacement,
        template: certTemplate,
      };
      savedCertSignatureRef.current = certStateSignature({
        title: nextTitle,
        passingPercent: nextPassing,
        placement: nextPlacement,
        template: certTemplate,
      });

      if (!(opts?.silent ?? false)) {
        toast.success("Certificate settings saved.");
      }
    } catch (e) {
      if (!(opts?.silent ?? false)) {
        toast.error(e instanceof Error ? e.message : "Failed to save certificate settings.");
      }
      throw e;
    } finally {
      setCertSaving(false);
    }
  }

  const saveCertificateSettingsRef = useRef(saveCertificateSettings);
  saveCertificateSettingsRef.current = saveCertificateSettings;

  async function uploadCertificateTemplate(courseIdToUse: string, file: File) {
    setCertTplUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await fetchJson<Record<string, unknown>>(`/api/courses/${courseIdToUse}/certificate-template`, { method: "POST", body: form });
      setCertTplFile(null);
      setCertTplPreviewUrl(null);
      await loadCertificateSettingsAndTemplate(courseIdToUse);
      toast.success("Certificate template uploaded.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to upload certificate template.");
    } finally {
      setCertTplUploading(false);
      setIsCertTplDragActive(false);
    }
  }

  function applyCertificateTemplateFile(file: File | null) {
    if (!file) return;
    if (!courseId) {
      toast.error("Create the course draft first to upload a certificate template.");
      return;
    }
    const allowed = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
    if (!allowed.has(file.type)) {
      toast.error("Invalid template type. Allowed: PDF, PNG, JPG, WebP.");
      return;
    }
    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      toast.error("Template is too large. Max size is 10MB.");
      return;
    }

    setCertTplFile(file);
    if (file.type.startsWith("image/")) {
      const u = URL.createObjectURL(file);
      setCertTplPreviewUrl(u);
    } else {
      setCertTplPreviewUrl(null);
    }
    // Clear input so selecting the same file again re-triggers onChange.
    try {
      if (certTplInputRef.current) certTplInputRef.current.value = "";
    } catch {
      // ignore
    }
    void uploadCertificateTemplate(courseId, file);
  }

  async function deleteCertificateTemplate(courseIdToUse: string) {
    setCertTplUploading(true);
    try {
      await fetchJson<Record<string, unknown>>(`/api/courses/${courseIdToUse}/certificate-template`, { method: "DELETE" });
      await loadCertificateSettingsAndTemplate(courseIdToUse);
      toast.success("Certificate template removed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove certificate template.");
    } finally {
      setCertTplUploading(false);
    }
  }

  useEffect(() => {
    if (!courseId) return;
    void loadCertificateSettingsAndTemplate(courseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  useEffect(() => {
    if (!certTplPreviewUrl) return;
    return () => {
      try {
        URL.revokeObjectURL(certTplPreviewUrl);
      } catch {
        // ignore
      }
    };
  }, [certTplPreviewUrl]);

  useEffect(() => {
    if (!courseId) return;
    if (certLoading) return;
    if (isBusy) return;
    if (certTplUploading) return;
    if (certSaving) return;

    const dirty = certSignature !== savedCertSignatureRef.current;
    if (!dirty) {
      if (certAutoSaveTimerRef.current) {
        window.clearTimeout(certAutoSaveTimerRef.current);
        certAutoSaveTimerRef.current = null;
      }
      // Preserve the "Saved" indicator until its own timer clears it.
      if (certAutoStatus === "saving") setCertAutoStatus("idle");
      return;
    }

    if (certAutoClearTimerRef.current) {
      window.clearTimeout(certAutoClearTimerRef.current);
      certAutoClearTimerRef.current = null;
    }

    if (certAutoSaveTimerRef.current) {
      window.clearTimeout(certAutoSaveTimerRef.current);
      certAutoSaveTimerRef.current = null;
    }

    setCertAutoStatus("saving");
    certAutoSaveTimerRef.current = window.setTimeout(() => {
      certAutoSaveTimerRef.current = null;
      void (async () => {
        try {
          await saveCertificateSettingsRef.current(
            courseId,
            {
              certificate_title: certTitle,
              course_passing_grade_percent: certPassingPercent,
              name_placement_json: certPlacement,
            },
            { silent: true }
          );
          setCertAutoStatus("saved");
          certAutoClearTimerRef.current = window.setTimeout(() => {
            certAutoClearTimerRef.current = null;
            setCertAutoStatus("idle");
          }, 2000);
        } catch {
          setCertAutoStatus("error");
        }
      })();
    }, 650);
  }, [
    certAutoStatus,
    certLoading,
    certPassingPercent,
    certPlacement,
    certSaving,
    certSignature,
    certTitle,
    certTplUploading,
    courseId,
    isBusy,
  ]);

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasUnsavedChanges) return;
      e.preventDefault();
      // Required for Chrome: setting returnValue triggers the native confirm dialog.
      e.returnValue = "";
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    function onDocumentClickCapture(e: MouseEvent) {
      if (!hasUnsavedChanges) return;
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as Element | null;
      if (!target) return;
      if (target.closest("[data-leave-guard-ignore='true']")) return;
      const a = target.closest("a") as HTMLAnchorElement | null;
      if (!a) return;
      if (a.target && a.target.toLowerCase() === "_blank") return;
      if (a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;

      e.preventDefault();
      e.stopPropagation();
      setLeavePrompt({ href: `${url.pathname}${url.search}${url.hash}` });
    }

    document.addEventListener("click", onDocumentClickCapture, true);
    return () => document.removeEventListener("click", onDocumentClickCapture, true);
  }, [hasUnsavedChanges]);

  function discardAllChanges() {
    const snap = savedSnapshotRef.current;
    const certSnap = savedCertSnapshotRef.current;
    for (const v of Object.values(pendingLessonUploadsByItemId ?? {})) {
      revokeInlineQueueObjectUrls(v?.inlineImages ?? {});
    }
    revokeInlineQueueObjectUrls(pendingCourseAboutInlineImages ?? {});
    setCourseId(snap.courseId);
    setStatus(snap.status);
    setTitle(snap.title);
    setSlug(snap.slug);
    setIsSlugManuallyEdited(snap.isSlugManuallyEdited);
    setAboutHtml(snap.aboutHtml);
    setPendingCourseAboutInlineImages({});
    setExcerpt(snap.excerpt);
    setDifficulty(snap.difficulty ?? "all_levels");
    setWhatWillLearn(snap.whatWillLearn);
    setHours(snap.hours ?? 0);
    setMinutes(snap.minutes ?? 0);
    setMaterialsIncluded(snap.materialsIncluded);
    setRequirements(snap.requirements);
    setVideoProvider(snap.videoProvider);
    setVideoUrl(snap.videoUrl);
    setVideoFile(null);
    setThumbnailUrl(snap.thumbnailUrl);
    setThumbnailFile(null);
    setPendingThumbnailRemoval(false);
    setSelectedMemberIds(new Set(snap.selectedMemberIds ?? []));
    setTopics(deepClone(snap.topics ?? []));
    setPendingDeletedItemIds([]);
    setPendingDeletedTopicIds([]);
    setPendingLessonUploadsByItemId({});
    setTopicModal(null);
    setItemModal(null);
    setCertTitle(String(certSnap.title ?? ""));
    setCertPassingPercent(Number.isFinite(Number(certSnap.passingPercent)) ? Number(certSnap.passingPercent) : 0);
    setCertPassingPercentInput(
      String(Number.isFinite(Number(certSnap.passingPercent)) ? Number(certSnap.passingPercent) : 0)
    );
    setCertPlacement(certSnap.placement ?? null);
    setCertTemplate(certSnap.template ?? null);
    setCertTplFile(null);
    setCertTplPreviewUrl(null);
    setCertAutoStatus("idle");
    setError(null);
  }

  useEffect(() => {
    if (!thumbnailFile) {
      setThumbnailObjectUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(thumbnailFile);
    setThumbnailObjectUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [thumbnailFile]);

  useEffect(() => {
    if (itemModalType !== "lesson") return;
    if (!lessonFeatureImageFile) {
      setItemModal((prev) => {
        if (!prev || prev.itemType !== "lesson") return prev;
        if (prev.featureImagePreviewUrl === null) return prev;
        return { ...prev, featureImagePreviewUrl: null };
      });
      return;
    }
    const u = URL.createObjectURL(lessonFeatureImageFile);
    setItemModal((prev) => {
      if (!prev || prev.itemType !== "lesson") return prev;
      return { ...prev, featureImagePreviewUrl: u };
    });
    return () => URL.revokeObjectURL(u);
  }, [itemModalType, lessonFeatureImageFile]);

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return memberOptions;
    return memberOptions.filter((m) => m.label.toLowerCase().includes(q));
  }, [memberOptions, memberSearch]);

  const allFilteredSelected = filteredMembers.length > 0 && filteredMembers.every((m) => selectedMemberIds.has(m.id));

  const permalink = useMemo(() => {
    const usableSlug = (slug || normalizeSlug(title || "course")).trim();
    if (!usableSlug) return "";
    return `${origin}/org/${encodeURIComponent(orgSlug)}/courses/${encodeURIComponent(usableSlug)}`;
  }, [origin, orgSlug, slug, title]);

  const canSave = title.trim().length >= 2;
  const canPublish = topics.length > 0 && canSave && hasMeaningfulRichText(aboutHtml);
  const previewHref = courseId ? `/org/${orgSlug}/courses/${encodeURIComponent((slug || "").trim() || courseId)}` : null;
  const canPreview = Boolean(previewHref) && !hasUnsavedChanges && !isBusy;

  const reorderItemsLocally = (topicId: string, orderedItemIds: string[]) => {
    setTopics((prev) =>
      prev.map((t) => {
        if (t.id !== topicId) return t;
        const byId = new Map(t.items.map((i) => [i.id, i]));
        const nextItems: CourseTopicItem[] = [];
        for (const id of orderedItemIds) {
          const it = byId.get(id);
          if (it) nextItems.push(it);
        }
        // Keep any items not included (safety).
        for (const it of t.items) {
          if (!orderedItemIds.includes(it.id)) nextItems.push(it);
        }
        return { ...t, items: nextItems.map((it, idx) => ({ ...it, position: idx })) };
      })
    );
  };

  const setTopicExpanded = (id: string, expanded: boolean) => {
    setExpandedTopicIds((prev) => {
      const next = new Set(prev);
      if (expanded) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  async function ensureCourseDraftExists(): Promise<string> {
    if (courseId) return courseId;
    if (title.trim().length < 2) throw new Error("Course name must be at least 2 characters.");

    const { data } = await fetchJson<{ course: { id: string; slug: string; status: "draft" | "published" } }>("/api/v2/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    const created = data.course;
    setCourseId(created.id);
    setSlug(created.slug);
    setStatus("draft");
    return created.id;
  }

  async function finalizeCourseAboutInlineImages(courseIdToUse: string): Promise<string> {
    const pruned = pruneQueueByHtml(pendingCourseAboutInlineImages ?? {}, aboutHtml ?? "");
    if (!Object.keys(pruned ?? {}).length) return aboutHtml;
    if (!aboutHtml || !aboutHtml.trim()) return aboutHtml;

    const { html: nextHtml, uploadedIds } = await finalizeInlineImagesInHtml({
      html: aboutHtml,
      queue: pruned,
      upload: async ({ uploadId, file }) => {
        const { data: sign } = await fetchJson<{ bucket_id: string; object_name: string; token: string }>(
          `/api/v2/courses/${courseIdToUse}/inline-images/sign`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mime: file.type, size_bytes: file.size, file_name: file.name }),
          }
        );
        const uploadRes = await supabase.storage.from(sign.bucket_id).uploadToSignedUrl(sign.object_name, sign.token, file, {
          contentType: file.type,
        });
        if (uploadRes.error) throw new Error(`Inline image upload failed: ${uploadRes.error.message}`);
        return { storage_path: String(sign.object_name ?? ""), upload_id: uploadId };
      },
      stableSrcForStoragePath: (storagePath) => `/api/v2/course-assets?path=${encodeURIComponent(storagePath)}`,
    });

    setPendingCourseAboutInlineImages(() => {
      const next: InlineImageQueue = { ...pruned };
      for (const id of uploadedIds) delete next[id];
      return next;
    });
    setAboutHtml(nextHtml);
    return nextHtml;
  }

  async function saveCore(courseIdToUse: string, opts?: { aboutHtmlOverride?: string }): Promise<SaveResultCourse> {
    const payload = {
      title: title.trim(),
      slug: slug.trim() || undefined,
      about_html: (opts?.aboutHtmlOverride ?? aboutHtml),
      excerpt: excerpt.trim(),
      difficulty_level: difficulty ?? "all_levels",
      what_will_learn: whatWillLearn,
      total_duration_hours: Number.isFinite(hours) ? hours : 0,
      total_duration_minutes: Number.isFinite(minutes) ? minutes : 0,
      materials_included: materialsIncluded,
      requirements_instructions: requirements,
      intro_video_provider: videoProvider,
      intro_video_url: videoProvider === "html5" ? null : videoUrl.trim(),
    };

    const { data } = await fetchJson<{ course: SaveResultCourse }>(`/api/v2/courses/${courseIdToUse}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return data.course;
  }

  async function saveMembers(courseIdToUse: string) {
    const member_ids = [...selectedMemberIds];
    const member_access: Record<string, AccessDurationKey> = {};
    for (const id of member_ids) {
      member_access[id] = memberAccessById[id] ?? memberDefaultAccess;
    }
    const now = new Date();
    await fetchJson<{ member_ids: string[] }>(`/api/v2/courses/${courseIdToUse}/members`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_ids, default_access: memberDefaultAccess, member_access }),
    });
    // Optimistic baseline update (server computes similarly; this keeps the badge accurate without a page reload).
    const nextBaseline: Record<string, string | null> = {};
    for (const id of member_ids) {
      const key = member_access[id] ?? "unlimited";
      nextBaseline[id] = computeAccessExpiresAt(key, now);
    }
    setBaselineMemberExpiresAtById(nextBaseline);
  }

  const getMembersSignature = useCallback((): string => {
    return buildMembersSignatureValue(memberDefaultAccess, selectedMemberIds, memberAccessById);
  }, [memberAccessById, memberDefaultAccess, selectedMemberIds]);

  function applyImportedMembersToLocalState(rows: CourseAssignmentCsvPreview["normalized_rows"]) {
    const now = new Date();
    const nextSelectedIds = new Set(rows.filter((row) => row.assigned).map((row) => row.user_id));
    const nextAccessById: Record<string, AccessDurationKey> = {};
    const nextBaselineById: Record<string, string | null> = {};

    for (const row of rows) {
      if (!row.assigned || !row.tfa) continue;
      nextAccessById[row.user_id] = row.tfa;
      nextBaselineById[row.user_id] = computeAccessExpiresAt(row.tfa, now);
    }

    setSelectedMemberIds(nextSelectedIds);
    setMemberAccessById(nextAccessById);
    setBaselineMemberExpiresAtById(nextBaselineById);
    memberAccessPreviewEpochMsRef.current = now.getTime();
    savedMembersSignatureRef.current = buildMembersSignatureValue(memberDefaultAccess, nextSelectedIds, nextAccessById);
  }

  function openCsvImportModal() {
    if (!courseId) {
      toast.error("Save the course first before importing member assignments.");
      return;
    }
    setCsvImportOpen(true);
    setCsvImportPreview(null);
    setCsvImportFileName(null);
  }

  async function handleCsvImportSelected(file: File | null) {
    if (!file || !courseId) return;
    setCsvPreviewLoading(true);
    setCsvImportFileName(file.name);
    setCsvImportPreview(null);
    const t = toast.loading("Validating CSV…");
    try {
      const form = new FormData();
      form.append("file", file);
      const { data, message } = await fetchJson<CourseAssignmentCsvPreview>(
        `/api/org/courses/${courseId}/assignments/csv-import/preview`,
        { method: "POST", body: form }
      );
      setCsvImportPreview(data);
      toast.success(message || "CSV preview ready.", { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to preview CSV import.", { id: t });
    } finally {
      setCsvPreviewLoading(false);
    }
  }

  async function applyCsvImport() {
    if (!courseId || !csvImportPreview) return;
    setCsvApplyLoading(true);
    const t = toast.loading("Applying CSV import…");
    try {
      const { message } = await fetchJson<{
        course_id: string;
        assigned_count: number;
        updated_count: number;
        removed_count: number;
        unchanged_count: number;
      }>(`/api/org/courses/${courseId}/assignments/csv-import/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: csvImportPreview.normalized_rows }),
      });
      applyImportedMembersToLocalState(csvImportPreview.normalized_rows);
      setCsvImportOpen(false);
      setCsvImportPreview(null);
      setCsvImportFileName(null);
      toast.success(message || "CSV import applied.", { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to apply CSV import.", { id: t });
    } finally {
      setCsvApplyLoading(false);
    }
  }

  function downloadAssignmentCsvTemplate() {
    if (!courseId) {
      toast.error("Save the course first before exporting the CSV template.");
      return;
    }
    window.open(`/api/org/courses/${courseId}/assignments/csv`, "_blank", "noopener,noreferrer");
  }

  const savedMembersSignatureRef = useRef<string>("");
  useEffect(() => {
    if (savedMembersSignatureRef.current) return;
    savedMembersSignatureRef.current = getMembersSignature();
  }, [getMembersSignature]);

  function isTempId(id: string): boolean {
    return id.startsWith("tmp_");
  }

  async function syncCurriculumToServer(courseIdToUse: string): Promise<CourseTopic[]> {
    function stableJsonStringify(value: unknown): string {
      const seen = new WeakSet<object>();
      const normalize = (v: unknown): unknown => {
        if (!v) return v;
        if (typeof v !== "object") return v;
        if (seen.has(v as object)) return null;
        seen.add(v as object);
        if (Array.isArray(v)) return v.map(normalize);
        const obj = v as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(obj).sort()) out[k] = normalize(obj[k]);
        return out;
      };
      return JSON.stringify(normalize(value));
    }

    async function runWithConcurrency<T>(limit: number, fns: Array<() => Promise<T>>): Promise<T[]> {
      const results: T[] = new Array(fns.length);
      let next = 0;
      const workers = Array.from({ length: Math.min(limit, fns.length) }, async () => {
        while (true) {
          const idx = next++;
          if (idx >= fns.length) break;
          results[idx] = await fns[idx]();
        }
      });
      await Promise.all(workers);
      return results;
    }

    // 0) Apply buffered deletions first (this enqueues delayed Storage cleanup via DELETE endpoints).
    const processedItemDeletes = new Set<string>();
    for (const itemId of pendingDeletedItemIds) {
      if (isTempId(itemId)) continue;
      try {
        await fetchJson(`/api/v2/items/${itemId}`, { method: "DELETE" });
        processedItemDeletes.add(itemId);
      } catch (e) {
        // Treat already-deleted as success so we never get stuck retrying.
        if (e instanceof ApiClientError && e.status === 404) {
          processedItemDeletes.add(itemId);
          continue;
        }
        throw e;
      }
    }
    if (processedItemDeletes.size) {
      setPendingDeletedItemIds((prev) => prev.filter((id) => !processedItemDeletes.has(id)));
    }

    const processedTopicDeletes = new Set<string>();
    for (const topicId of pendingDeletedTopicIds) {
      if (isTempId(topicId)) continue;
      try {
        await fetchJson(`/api/v2/topics/${topicId}`, { method: "DELETE" });
        processedTopicDeletes.add(topicId);
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 404) {
          processedTopicDeletes.add(topicId);
          continue;
        }
        throw e;
      }
    }
    if (processedTopicDeletes.size) {
      setPendingDeletedTopicIds((prev) => prev.filter((id) => !processedTopicDeletes.has(id)));
    }

    const topicsToSync = topics.filter((t) => !pendingDeletedTopicIds.includes(t.id));

    // 1) Sync curriculum STRUCTURE (create/update/reorder/delete) in a single DB transaction via RPC.
    const rpcPayload = {
      topics: topicsToSync.map((t, tIdx) => ({
        client_id: t.id,
        // RPC expects `id` for BOTH existing UUIDs and temp client IDs (e.g. "tmp_...").
        id: t.id,
        title: t.title,
        summary: t.summary ?? null,
        position: tIdx,
        items: (t.items ?? [])
          .filter((it) => !pendingDeletedItemIds.includes(it.id))
          .map((it, iIdx) => ({
            client_id: it.id,
            id: it.id,
            item_type: it.item_type,
            title: it.title ?? null,
            is_required: Boolean((it as { is_required?: unknown }).is_required),
            position: iIdx,
          })),
      })),
    };

    const { data: rpcRes } = await fetchJson<{ id_map?: Record<string, string> }>(`/api/v2/courses/${courseIdToUse}/curriculum/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcPayload),
    });

    const idMapRaw = (rpcRes as { id_map?: Record<string, string> } | null)?.id_map ?? {};
    const resolveId = (id: string) => {
      const v = idMapRaw[id];
      return typeof v === "string" && v.trim().length > 0 ? v : id;
    };

    const resolvedToClientItemId = new Map<string, string>();
    const resolvedTopics: CourseTopic[] = topicsToSync.map((t, tIdx) => {
      const resolvedTopicId = resolveId(t.id);
      const nextItems: CourseTopicItem[] = (t.items ?? [])
        .filter((it) => !pendingDeletedItemIds.includes(it.id))
        .map((it, iIdx) => {
          const resolvedItemId = resolveId(it.id);
          resolvedToClientItemId.set(resolvedItemId, it.id);
          return {
            ...it,
            id: resolvedItemId,
            position: iIdx,
            is_required: Boolean((it as { is_required?: unknown }).is_required),
            payload_json: (it.payload_json ?? {}) as Record<string, unknown>,
          };
        });
      return {
        ...t,
        id: resolvedTopicId,
        position: tIdx,
        items: nextItems,
      };
    });

    // 2) Patch only CHANGED/NEW item payload_json (and upload queued assets) with a concurrency limit.
    const savedPayloadSigById = new Map<string, string>();
    for (const t of savedSnapshotRef.current.topics ?? []) {
      for (const it of t.items ?? []) {
        savedPayloadSigById.set(it.id, stableJsonStringify((it.payload_json ?? {}) as Record<string, unknown>));
      }
    }

    const patchTasks: Array<() => Promise<CourseTopicItem | null>> = [];
    for (const topic of resolvedTopics) {
      for (const item of topic.items ?? []) {
        patchTasks.push(async () => {
          const resolvedItemId = item.id;
          const clientItemId = resolvedToClientItemId.get(resolvedItemId) ?? resolvedItemId;
          const pendingUploads = pendingLessonUploadsByItemId[clientItemId] ?? pendingLessonUploadsByItemId[resolvedItemId] ?? null;

          let nextPayload: Record<string, unknown> = { ...(item.payload_json ?? {}) };
          let shouldPatch = false;

          // LESSON: upload assets + rewrite inline images, then patch payload_json.
          if (item.item_type === "lesson" && pendingUploads) {
            shouldPatch = true;
            const p = nextPayload as Record<string, unknown>;
            const basePayload: Record<string, unknown> = { ...p };

          let featureImageStoragePath: string | null =
            typeof (p.feature_image as { storage_path?: unknown } | null)?.storage_path === "string"
              ? String((p.feature_image as { storage_path: string }).storage_path)
              : null;

          if (pendingUploads.featureImageFile) {
            const file = pendingUploads.featureImageFile;
            const { data: sign } = await fetchJson<{ bucket_id: string; object_name: string; token: string }>(
              `/api/v2/items/${resolvedItemId}/lesson/feature-image/sign`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mime: file.type, size_bytes: file.size }),
              }
            );
            const uploadRes = await supabase.storage.from(sign.bucket_id).uploadToSignedUrl(sign.object_name, sign.token, file, {
              contentType: file.type,
            });
            if (uploadRes.error) throw new Error(`Feature image upload failed: ${uploadRes.error.message}`);
            featureImageStoragePath = sign.object_name;
          }

          let videoStoragePath: string | null =
            typeof (p.video as { storage_path?: unknown } | null)?.storage_path === "string"
              ? String((p.video as { storage_path: string }).storage_path)
              : null;

          const video = (p.video ?? {}) as { provider?: unknown };
          const provider = video?.provider === "youtube" || video?.provider === "vimeo" ? (video.provider as string) : "html5";
          if (provider === "html5" && pendingUploads.videoFile) {
            const file = pendingUploads.videoFile;
            const { data: sign } = await fetchJson<{ bucket_id: string; object_name: string; token: string }>(
              `/api/v2/items/${resolvedItemId}/lesson/video/sign`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mime: "video/mp4", size_bytes: file.size }),
              }
            );
            const uploadRes = await supabase.storage.from(sign.bucket_id).uploadToSignedUrl(sign.object_name, sign.token, file, {
              contentType: file.type,
            });
            if (uploadRes.error) throw new Error(`Lesson video upload failed: ${uploadRes.error.message}`);
            videoStoragePath = sign.object_name;
          }

          let uploadedAttachments = Array.isArray((p as { attachments?: unknown }).attachments) ? ((p as { attachments: unknown[] }).attachments as unknown[]) : [];
          if (pendingUploads.attachments?.length) {
            const files = pendingUploads.attachments;
            const { data: signed } = await fetchJson<{
              bucket_id: string;
              uploads: Array<{ file_name: string; mime: string | null; size_bytes: number; object_name: string; token: string }>;
            }>(`/api/v2/items/${resolvedItemId}/lesson/attachments/sign`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                files: files.map((f) => ({ file_name: f.name, mime: f.type || null, size_bytes: f.size })),
              }),
            });

            for (let i = 0; i < files.length; i++) {
              const file = files[i];
              const u = signed.uploads[i];
              if (!u) throw new Error("Attachment signing mismatch.");
              const up = await supabase.storage.from(signed.bucket_id).uploadToSignedUrl(u.object_name, u.token, file, {
                contentType: file.type || "application/octet-stream",
              });
              if (up.error) throw new Error(`Attachment upload failed: ${up.error.message}`);
            }

            const newAttachments: LessonModalState["existingAttachments"] = signed.uploads.map((u, idx) => {
              const f = files[idx];
              return {
                file_name: f?.name ?? u.file_name,
                storage_path: u.object_name,
                size_bytes: f?.size ?? u.size_bytes,
                mime: (f?.type || u.mime || null) as string | null,
              };
            });
            uploadedAttachments = [...uploadedAttachments, ...newAttachments];
          }

          // Upload inline images referenced inside lesson HTML blocks, then rewrite <img src> to a stable app URL.
          // This keeps the "no auto-save" rule: we only upload + persist on explicit Save / Publish.
          const rawBlocks = Array.isArray((basePayload as { content_blocks?: unknown }).content_blocks)
            ? ((basePayload as { content_blocks: unknown[] }).content_blocks as unknown[])
            : null;

          let contentBlocks: string[] = [];
          if (rawBlocks && rawBlocks.length) {
            contentBlocks = rawBlocks.map((v) => (typeof v === "string" ? v : "")).filter((v) => typeof v === "string");
          } else {
            const fallbackHtml = typeof (basePayload as { content_html?: unknown }).content_html === "string" ? String((basePayload as { content_html: string }).content_html) : "";
            contentBlocks = [fallbackHtml];
          }

          const joinedBefore = contentBlocks.join(LESSON_BLOCK_SEPARATOR);
          const workingQueue = pruneQueueByHtml(pendingUploads.inlineImages ?? {}, joinedBefore);

          if (Object.keys(workingQueue).length) {
            const rewrittenBlocks: string[] = [];
            for (const blockHtml of contentBlocks) {
              const blockQueue = pruneQueueByHtml(workingQueue, blockHtml);
              if (blockHtml && Object.keys(blockQueue).length) {
                const res = await finalizeInlineImagesInHtml({
                  html: blockHtml,
                  queue: blockQueue,
                  upload: async ({ uploadId, file }) => {
                    const { data: sign } = await fetchJson<{ bucket_id: string; object_name: string; token: string }>(
                      `/api/v2/items/${resolvedItemId}/lesson/inline-images/sign`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ mime: file.type, size_bytes: file.size, file_name: file.name }),
                      }
                    );
                    const uploadRes = await supabase.storage.from(sign.bucket_id).uploadToSignedUrl(sign.object_name, sign.token, file, {
                      contentType: file.type,
                    });
                    if (uploadRes.error) throw new Error(`Inline image upload failed: ${uploadRes.error.message}`);
                    return { storage_path: String(sign.object_name ?? ""), upload_id: uploadId };
                  },
                  stableSrcForStoragePath: (storagePath) => `/api/v2/lesson-assets?path=${encodeURIComponent(storagePath)}`,
                });
                rewrittenBlocks.push(res.html);
                for (const id of res.uploadedIds) {
                  delete workingQueue[id];
                }
              } else {
                rewrittenBlocks.push(blockHtml);
              }
            }
            contentBlocks = rewrittenBlocks;
          }

          const contentHtml = contentBlocks.map((h) => (h ?? "").trim()).filter((v) => v.length > 0).join(LESSON_BLOCK_SEPARATOR);

          const finalPayload: Record<string, unknown> = {
            ...basePayload,
            content_blocks: contentBlocks,
            content_html: contentHtml,
            feature_image: featureImageStoragePath ? { storage_path: featureImageStoragePath } : null,
            video:
              provider === "html5"
                ? videoStoragePath
                  ? { ...(typeof p.video === "object" && p.video ? (p.video as Record<string, unknown>) : {}), provider: "html5", storage_path: videoStoragePath }
                  : { ...(typeof p.video === "object" && p.video ? (p.video as Record<string, unknown>) : {}), provider: "html5" }
                : p.video,
            attachments: uploadedAttachments,
          };
            nextPayload = finalPayload;
          }

          // QUIZ: upload queued images and migrate any legacy data-URL option images before patching payload_json.
          const hasQueuedQuizImages = Boolean(pendingUploads && Object.keys(pendingUploads.inlineImages ?? {}).length);
          const hasLegacyQuizDataUrls = item.item_type === "quiz" && JSON.stringify(nextPayload).includes("data:image/");
          if (item.item_type === "quiz" && (hasQueuedQuizImages || hasLegacyQuizDataUrls)) {
            shouldPatch = true;
            const base = nextPayload as Record<string, unknown>;
            const workingQueue: InlineImageQueue = { ...(pendingUploads?.inlineImages ?? {}) };
            const rawQuestions = Array.isArray((base as { questions?: unknown }).questions) ? ((base as { questions: unknown[] }).questions as unknown[]) : [];
            const stableSrcForStoragePath = (storagePath: string) => `/api/v2/lesson-assets?path=${encodeURIComponent(storagePath)}`;
            const uploadQuizImage = async ({ uploadId, file }: { uploadId: string; file: File }) => {
              const { data: sign } = await fetchJson<{ bucket_id: string; object_name: string; token: string }>(
                `/api/v2/items/${resolvedItemId}/lesson/inline-images/sign`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ mime: file.type, size_bytes: file.size, file_name: file.name }),
                }
              );
              const uploadRes = await supabase.storage.from(sign.bucket_id).uploadToSignedUrl(sign.object_name, sign.token, file, {
                contentType: file.type,
              });
              if (uploadRes.error) throw new Error(`Quiz image upload failed: ${uploadRes.error.message}`);
              return { storage_path: String(sign.object_name ?? ""), upload_id: uploadId };
            };

            const nextQuestions = [];
            for (const q of rawQuestions) {
              if (!q || typeof q !== "object") {
                nextQuestions.push(q);
                continue;
              }
              const qq = q as Record<string, unknown>;
              let desc = typeof qq.description_html === "string" ? (qq.description_html as string) : "";
              let expl = typeof qq.answer_explanation_html === "string" ? (qq.answer_explanation_html as string) : "";
              if (desc && Object.keys(workingQueue).length) {
                const res = await finalizeInlineImagesInHtml({
                  html: desc,
                  queue: workingQueue,
                  upload: uploadQuizImage,
                  stableSrcForStoragePath,
                });
                desc = res.html;
                for (const id of res.uploadedIds) delete workingQueue[id];
              }
              if (expl && Object.keys(workingQueue).length) {
                const res = await finalizeInlineImagesInHtml({
                  html: expl,
                  queue: workingQueue,
                  upload: uploadQuizImage,
                  stableSrcForStoragePath,
                });
                expl = res.html;
                for (const id of res.uploadedIds) delete workingQueue[id];
              }

              const rawOptions = Array.isArray((qq as { options?: unknown }).options) ? ((qq as { options: unknown[] }).options as unknown[]) : [];
              const nextOptions = [];
              for (let optionIdx = 0; optionIdx < rawOptions.length; optionIdx++) {
                const option = rawOptions[optionIdx];
                if (!option || typeof option !== "object") {
                  nextOptions.push(option);
                  continue;
                }
                const oo = option as Record<string, unknown>;
                const imageUploadId = typeof oo.image_upload_id === "string" && oo.image_upload_id.trim().length ? oo.image_upload_id.trim() : null;
                let imageDataUrl = typeof oo.image_data_url === "string" && oo.image_data_url.trim().length ? oo.image_data_url.trim() : null;

                if (imageUploadId && workingQueue[imageUploadId]?.file) {
                  const uploaded = await uploadQuizImage({ uploadId: imageUploadId, file: workingQueue[imageUploadId].file });
                  imageDataUrl = stableSrcForStoragePath(uploaded.storage_path);
                  revokeObjectUrlSafe(workingQueue[imageUploadId].objectUrl);
                  delete workingQueue[imageUploadId];
                } else if (imageDataUrl?.startsWith("data:image/")) {
                  const fallbackName = `quiz-option-${String(oo.id ?? optionIdx)}`;
                  const file = await fileFromImageDataUrl(imageDataUrl, fallbackName);
                  if (file) {
                    const uploaded = await uploadQuizImage({ uploadId: imageUploadId ?? makeTempId("option_image"), file });
                    imageDataUrl = stableSrcForStoragePath(uploaded.storage_path);
                  }
                }

                const nextOption = { ...oo, image_data_url: imageDataUrl };
                delete (nextOption as { image_upload_id?: unknown }).image_upload_id;
                nextOptions.push(nextOption);
              }

              nextQuestions.push({ ...qq, description_html: desc, answer_explanation_html: expl, options: nextOptions });
            }

            nextPayload = { ...base, questions: nextQuestions };
          }

          const prevSig = savedPayloadSigById.get(resolvedItemId) ?? null;
          const nextSig = stableJsonStringify(nextPayload);
          if (!shouldPatch && prevSig !== nextSig) shouldPatch = true;

          // On new items, only patch when there's meaningful payload content.
          if (!prevSig && !shouldPatch) {
            const isEmpty = nextSig === "{}" || nextSig === "null";
            if (!isEmpty) shouldPatch = true;
          }

          if (!shouldPatch) return null;

          const { data: patched } = await fetchJson<{ item: CourseTopicItem }>(`/api/v2/items/${resolvedItemId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payload_json: nextPayload }),
          });
          return patched.item;
        });
      }
    }

    const patchedItems = await runWithConcurrency(3, patchTasks);
    const patchedById = new Map<string, CourseTopicItem>();
    for (const it of patchedItems) {
      if (it && typeof it.id === "string") patchedById.set(it.id, it);
    }

    return resolvedTopics.map((t, idx) => ({
      ...t,
      position: idx,
      items: (t.items ?? []).map((it, iIdx) => {
        const patched = patchedById.get(it.id);
        return patched ? { ...patched, position: iIdx } : { ...it, position: iIdx };
      }),
    }));
  }

  async function uploadIntroVideo(courseIdToUse: string) {
    if (videoProvider === "html5") {
      if (!videoFile) return;
      const { data: sign } = await fetchJson<{ bucket_id: string; object_name: string; token: string }>(
        `/api/v2/courses/${courseIdToUse}/intro-video/sign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mime: "video/mp4", size_bytes: videoFile.size }),
        }
      );

      const uploadRes = await supabase.storage.from(sign.bucket_id).uploadToSignedUrl(sign.object_name, sign.token, videoFile, {
        contentType: videoFile.type,
      });
      if (uploadRes.error) {
        throw new Error(`Intro video upload failed: ${uploadRes.error.message}`);
      }

      await fetchJson(`/api/v2/courses/${courseIdToUse}/intro-video/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage_path: sign.object_name, mime: "video/mp4", size_bytes: videoFile.size }),
      });

      setVideoFile(null);
      return;
    }

    if (!videoUrl.trim()) return;
    const form = new FormData();
    form.append("provider", videoProvider);
    form.append("url", videoUrl.trim());
    await fetchJson(`/api/v2/courses/${courseIdToUse}/intro-video`, { method: "POST", body: form });
  }

  function applyVideoFile(file: File | null) {
    if (!file) return;
    if (file.type !== "video/mp4") {
      toast.error("Invalid video type. Allowed: MP4.");
      return;
    }
    const maxBytes = 300 * 1024 * 1024;
    if (file.size > maxBytes) {
      toast.error("Video is too large. Max size is 300MB.");
      return;
    }
    setVideoFile(file);
  }

  async function uploadThumbnail(courseIdToUse: string) {
    if (!thumbnailFile) return;
    const file = thumbnailFile;

    if (busyActionRef.current) {
      setBusyStep("Uploading thumbnail");
    }

    const form = new FormData();
    form.append("file", file);

    const { data } = await fetchJson<{ cover_image_url: string }>(`/api/v2/courses/${courseIdToUse}/thumbnail`, {
      method: "POST",
      body: form,
    });

    setThumbnailUrl(data.cover_image_url);
    setThumbnailFile(null);
  }

  async function removeThumbnailOnServer(courseIdToUse: string) {
    if (!pendingThumbnailRemoval) return;
    await fetchJson(`/api/v2/courses/${courseIdToUse}/thumbnail`, { method: "DELETE" });
    setPendingThumbnailRemoval(false);
    setThumbnailUrl("");
    setThumbnailFile(null);
  }

  async function runStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
    if (busyActionRef.current) {
      setBusyStep(step);
      setBusyVisitedSteps((prev) => (prev.includes(step) ? prev : [...prev, step]));
    }
    try {
      return await fn();
    } catch (e) {
      throw new StepError(step, e);
    }
  }

  function setErrorWithSupport(opts: {
    message: string;
    step?: string | null;
    supportId?: string | null;
    canReport: boolean;
    reportPayload?: Record<string, unknown> | null;
  }) {
    setError(opts.message);
    setErrorStep(opts.step ?? null);
    setErrorSupportId(opts.supportId ?? null);
    setErrorCanReport(opts.canReport);
    setErrorReportPayload(opts.reportPayload ?? null);
    setErrorReportSent(false);
  }

  function normalizeStepError(e: unknown): {
    step: string | null;
    cause: unknown;
    api: ApiClientError | null;
  } {
    const step = e instanceof StepError ? e.step : null;
    const cause = e instanceof StepError ? e.cause : e;
    const api = cause instanceof ApiClientError ? cause : null;
    return { step, cause, api };
  }

  function isReportableSystemError(info: { api: ApiClientError | null; cause: unknown }): boolean {
    if (info.api) return info.api.status >= 500 || info.api.code === "INTERNAL";
    const msg = info.cause instanceof Error ? info.cause.message : String(info.cause ?? "");
    const m = msg.toLowerCase();
    return m.includes("request failed") || m.includes("failed to fetch") || m.includes("network");
  }

  function buildReportPayload(input: {
    supportId: string;
    step: string | null;
    context: Record<string, unknown>;
    cause: unknown;
    api: ApiClientError | null;
  }): Record<string, unknown> {
    const err = input.cause instanceof Error ? input.cause : null;
    return {
      support_id: input.supportId,
      source: "course_builder_v2",
      step: input.step,
      page_url: typeof window !== "undefined" ? window.location.href : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      payload: {
        context: input.context,
        error: {
          name: err?.name ?? null,
          message: err?.message ?? String(input.cause ?? ""),
          stack: err?.stack ?? null,
        },
        api: input.api
          ? {
              status: input.api.status,
              code: input.api.code ?? null,
              support_id: input.api.supportId ?? null,
              raw: input.api.raw ?? null,
            }
          : null,
      },
    };
  }

  async function reportCurrentError() {
    if (!errorReportPayload || errorReportSending || errorReportSent) return;
    setErrorReportSending(true);
    try {
      const { data } = await fetchJson<{ support_report_id: string; support_id: string }>(`/api/v2/support/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(errorReportPayload),
      });
      setErrorReportSent(true);
      if (!errorSupportId && typeof data.support_id === "string") {
        setErrorSupportId(data.support_id);
      }
      toast.success("Error reported to Support.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to report error.");
    } finally {
      setErrorReportSending(false);
    }
  }

  async function applyThumbnailFile(file: File | null) {
    if (!file) return;
    const seq = thumbnailPrepareSeqRef.current + 1;
    thumbnailPrepareSeqRef.current = seq;
    if (!THUMBNAIL_ALLOWED_MIME.has(file.type)) {
      toast.error("Invalid thumbnail type. Allowed: PNG, JPG, WebP.");
      return;
    }
    if (file.size > THUMBNAIL_MAX_BYTES) {
      toast.error("Thumbnail is too large. Max size is 10MB.");
      return;
    }
    const toastId = toast.loading("Preparing thumbnail...");
    try {
      const webpFile = await convertImageFileToThumbnailWebp(file);
      if (thumbnailPrepareSeqRef.current !== seq) {
        toast.dismiss(toastId);
        return;
      }
      setPendingThumbnailRemoval(false);
      setThumbnailFile(webpFile);
      toast.dismiss(toastId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to prepare thumbnail.", { id: toastId });
    }
  }

  function removeThumbnailLocal() {
    thumbnailPrepareSeqRef.current += 1;
    // Clear input value so selecting the same file again re-triggers onChange.
    try {
      if (thumbnailInputRef.current) thumbnailInputRef.current.value = "";
    } catch {
      // ignore
    }

    setThumbnailFile(null);
    setThumbnailUrl("");
    setPendingThumbnailRemoval(true);
  }

  async function savePublished(opts?: { afterSuccessNavigateTo?: string; showSuccessModal?: boolean; silent?: boolean }) {
    setError(null);
    setIsBusy(true);
    if (!(opts?.silent ?? false)) {
      busyActionRef.current = "save_published";
      setBusyAction("save_published");
      setBusyStep(null);
      setBusyVisitedSteps([]);
    }
    let courseIdForContext: string | null = null;
    try {
      const id = await runStep("Preparing course", () => ensureCourseDraftExists());
      courseIdForContext = id;
      const aboutFinal = await runStep("Saving About Course content", () => finalizeCourseAboutInlineImages(id));
      const saved = await runStep("Saving course details", () => saveCore(id, { aboutHtmlOverride: aboutFinal }));
      const membersSigBefore = getMembersSignature();
      if (membersSigBefore !== savedMembersSignatureRef.current) {
        await runStep("Saving members", () => saveMembers(id));
      }
      await runStep("Uploading intro video", () => uploadIntroVideo(id));
      if (pendingThumbnailRemoval || thumbnailFile) {
        await runStep("Updating thumbnail", async () => {
          await removeThumbnailOnServer(id);
          await uploadThumbnail(id);
        });
      }
      const syncedTopics = await runStep("Saving chapters and lessons", () => syncCurriculumToServer(id));
      setTopics(syncedTopics);
      setPendingDeletedItemIds([]);
      setPendingDeletedTopicIds([]);
      for (const v of Object.values(pendingLessonUploadsByItemId ?? {})) {
        revokeInlineQueueObjectUrls(v?.inlineImages ?? {});
      }
      revokeInlineQueueObjectUrls(pendingCourseAboutInlineImages ?? {});
      setPendingLessonUploadsByItemId({});
      setPendingCourseAboutInlineImages({});

      await runStep("Finalizing save", () => fetchJson(`/api/v2/courses/${id}/save`, { method: "POST" }));

      const finalSlug = saved.slug ?? slug;
      setSlug(finalSlug);
      setStatus("published");
      savedMembersSignatureRef.current = getMembersSignature();

      // Mark as saved (used by leave-guard / unsaved banner).
      savedSnapshotRef.current = {
        courseId: id,
        status: "published",
        title,
        slug: finalSlug,
        isSlugManuallyEdited,
        aboutHtml: aboutFinal,
        excerpt,
        difficulty,
        whatWillLearn,
        hours,
        minutes,
        materialsIncluded,
        requirements,
        videoProvider,
        videoUrl,
        thumbnailUrl,
        selectedMemberIds: [...selectedMemberIds],
        topics: deepClone(syncedTopics),
      };
      savedSignatureRef.current = JSON.stringify({
        courseId: id,
        status: "published",
        title,
        slug: finalSlug,
        isSlugManuallyEdited,
        aboutHtml: aboutFinal,
        excerpt,
        difficulty,
        whatWillLearn,
        hours,
        minutes,
        materialsIncluded,
        requirements,
        videoProvider,
        videoUrl,
        thumbnailUrl,
        members: [...selectedMemberIds].sort(),
        memberDefaultAccess,
        memberAccessSig: [...selectedMemberIds].sort().map((id) => ({ id, access: memberAccessById[id] ?? memberDefaultAccess })),
        topicsSig: syncedTopics.map((t) => ({
          id: t.id,
          title: t.title,
          summary: t.summary ?? null,
          position: t.position,
          items: (t.items ?? []).map((it) => ({
            id: it.id,
            item_type: it.item_type,
            title: it.title ?? null,
            is_required: Boolean((it as { is_required?: unknown }).is_required),
            position: it.position,
            payload_json: it.payload_json ?? {},
          })),
        })),
        pendingDeletedTopicIds: [],
        pendingDeletedItemIds: [],
        uploadSig: [],
        hasIntroVideoFile: false,
        hasThumbnailFile: false,
      });

      const silent = opts?.silent ?? false;
      const navigateTo = silent ? null : (opts?.afterSuccessNavigateTo ?? null);
      const showSuccessModal = silent ? false : (opts?.showSuccessModal ?? !navigateTo);
      if (navigateTo) {
        router.push(navigateTo);
        return;
      }

      if (!silent) {
        if (showSuccessModal) {
          setSuccessModal({
            title: "Changes saved",
            description: "Your updates are now live for learners.",
          });
        }
        if (mode === "create") {
          router.replace(`/org/${orgSlug}/courses/${id}/edit-v2`);
        } else {
          router.refresh();
        }
      }
    } catch (e) {
      const info = normalizeStepError(e);
      const reportable = isReportableSystemError({ api: info.api, cause: info.cause });
      const supportId = reportable ? (info.api?.supportId ?? generateSupportId()) : null;
      const step = info.step;
      const userMessage = reportable
        ? `${step ? `${step} failed.` : "Something went wrong."} Please report this error to Support.`
        : `${step ? `${step}: ` : ""}${info.cause instanceof Error ? info.cause.message : "Failed to save changes."}`;

      setErrorWithSupport({
        message: userMessage,
        step,
        supportId,
        canReport: reportable,
        reportPayload: reportable
          ? buildReportPayload({
              supportId: supportId ?? generateSupportId(),
              step,
              context: { action: "save_published", course_id: courseIdForContext, mode, status },
              cause: info.cause,
              api: info.api,
            })
          : null,
      });
    } finally {
      setIsBusy(false);
      busyActionRef.current = null;
      setBusyAction(null);
      setBusyStep(null);
      setBusyVisitedSteps([]);
    }
  }

  async function saveDraft(opts?: { afterSuccessNavigateTo?: string; showSuccessModal?: boolean; silent?: boolean }) {
    setError(null);
    setIsBusy(true);
    if (!(opts?.silent ?? false)) {
      busyActionRef.current = "save_draft";
      setBusyAction("save_draft");
      setBusyStep(null);
      setBusyVisitedSteps([]);
    }
    let courseIdForContext: string | null = null;
    try {
      const id = await runStep("Preparing course", () => ensureCourseDraftExists());
      courseIdForContext = id;
      const aboutFinal = await runStep("Saving About Course content", () => finalizeCourseAboutInlineImages(id));
      const saved = await runStep("Saving course details", () => saveCore(id, { aboutHtmlOverride: aboutFinal }));
      const membersSigBefore = getMembersSignature();
      if (membersSigBefore !== savedMembersSignatureRef.current) {
        await runStep("Saving members", () => saveMembers(id));
      }
      await runStep("Uploading intro video", () => uploadIntroVideo(id));
      if (pendingThumbnailRemoval || thumbnailFile) {
        await runStep("Updating thumbnail", async () => {
          await removeThumbnailOnServer(id);
          await uploadThumbnail(id);
        });
      }
      const syncedTopics = await runStep("Saving chapters and lessons", () => syncCurriculumToServer(id));
      setTopics(syncedTopics);
      setPendingDeletedItemIds([]);
      setPendingDeletedTopicIds([]);
      for (const v of Object.values(pendingLessonUploadsByItemId ?? {})) {
        revokeInlineQueueObjectUrls(v?.inlineImages ?? {});
      }
      revokeInlineQueueObjectUrls(pendingCourseAboutInlineImages ?? {});
      setPendingLessonUploadsByItemId({});
      setPendingCourseAboutInlineImages({});
      await runStep("Finalizing save", () => fetchJson(`/api/v2/courses/${id}/save-draft`, { method: "POST" }));
      const finalSlug = saved.slug ?? slug;
      setSlug(finalSlug);
      setStatus("draft");
      savedMembersSignatureRef.current = getMembersSignature();

      // Mark as saved (used by leave-guard / unsaved banner).
      savedSnapshotRef.current = {
        courseId: id,
        status: "draft",
        title,
        slug: finalSlug,
        isSlugManuallyEdited,
        aboutHtml: aboutFinal,
        excerpt,
        difficulty,
        whatWillLearn,
        hours,
        minutes,
        materialsIncluded,
        requirements,
        videoProvider,
        videoUrl,
        thumbnailUrl,
        selectedMemberIds: [...selectedMemberIds],
        topics: deepClone(syncedTopics),
      };
      savedSignatureRef.current = JSON.stringify({
        courseId: id,
        status: "draft",
        title,
        slug: finalSlug,
        isSlugManuallyEdited,
        aboutHtml: aboutFinal,
        excerpt,
        difficulty,
        whatWillLearn,
        hours,
        minutes,
        materialsIncluded,
        requirements,
        videoProvider,
        videoUrl,
        thumbnailUrl,
        members: [...selectedMemberIds].sort(),
        memberDefaultAccess,
        memberAccessSig: [...selectedMemberIds].sort().map((id) => ({ id, access: memberAccessById[id] ?? memberDefaultAccess })),
        topicsSig: syncedTopics.map((t) => ({
          id: t.id,
          title: t.title,
          summary: t.summary ?? null,
          position: t.position,
          items: (t.items ?? []).map((it) => ({
            id: it.id,
            item_type: it.item_type,
            title: it.title ?? null,
            is_required: Boolean((it as { is_required?: unknown }).is_required),
            position: it.position,
            payload_json: it.payload_json ?? {},
          })),
        })),
        pendingDeletedTopicIds: [],
        pendingDeletedItemIds: [],
        uploadSig: [],
        hasIntroVideoFile: false,
        hasThumbnailFile: false,
      });

      const silent = opts?.silent ?? false;
      const navigateTo = silent ? null : (opts?.afterSuccessNavigateTo ?? null);
      const showSuccessModal = silent ? false : (opts?.showSuccessModal ?? !navigateTo);
      if (navigateTo) {
        router.push(navigateTo);
        return;
      }

      if (!silent) {
        if (showSuccessModal) {
          setSuccessModal({
            title: "Draft saved",
            description: "Your course draft has been saved successfully.",
          });
        }
        if (mode === "create") {
          router.replace(`/org/${orgSlug}/courses/${id}/edit-v2`);
        } else {
          router.refresh();
        }
      }
    } catch (e) {
      const info = normalizeStepError(e);
      const reportable = isReportableSystemError({ api: info.api, cause: info.cause });
      const supportId = reportable ? (info.api?.supportId ?? generateSupportId()) : null;
      const step = info.step;
      const userMessage = reportable
        ? `${step ? `${step} failed.` : "Something went wrong."} Please report this error to Support.`
        : `${step ? `${step}: ` : ""}${info.cause instanceof Error ? info.cause.message : "Failed to save draft."}`;

      setErrorWithSupport({
        message: userMessage,
        step,
        supportId,
        canReport: reportable,
        reportPayload: reportable
          ? buildReportPayload({
              supportId: supportId ?? generateSupportId(),
              step,
              context: { action: "save_draft", course_id: courseIdForContext, mode, status },
              cause: info.cause,
              api: info.api,
            })
          : null,
      });
    } finally {
      setIsBusy(false);
      busyActionRef.current = null;
      setBusyAction(null);
      setBusyStep(null);
      setBusyVisitedSteps([]);
    }
  }

  async function publishCourse(opts?: { afterSuccessNavigateTo?: string; showSuccessModal?: boolean }) {
    setError(null);
    setIsBusy(true);
    busyActionRef.current = "publish";
    setBusyAction("publish");
    setBusyStep(null);
    setBusyVisitedSteps([]);
    const wasPublished = status === "published";
    let courseIdForContext: string | null = null;
    try {
      const id = await runStep("Preparing course", () => ensureCourseDraftExists());
      courseIdForContext = id;
      const aboutFinal = await runStep("Saving About Course content", () => finalizeCourseAboutInlineImages(id));
      const saved = await runStep("Saving course details", () => saveCore(id, { aboutHtmlOverride: aboutFinal }));
      const membersSigBefore = getMembersSignature();
      if (membersSigBefore !== savedMembersSignatureRef.current) {
        await runStep("Saving members", () => saveMembers(id));
      }
      await runStep("Uploading intro video", () => uploadIntroVideo(id));
      if (pendingThumbnailRemoval || thumbnailFile) {
        await runStep("Updating thumbnail", async () => {
          await removeThumbnailOnServer(id);
          await uploadThumbnail(id);
        });
      }
      const syncedTopics = await runStep("Saving chapters and lessons", () => syncCurriculumToServer(id));
      setTopics(syncedTopics);
      setPendingDeletedItemIds([]);
      setPendingDeletedTopicIds([]);
      for (const v of Object.values(pendingLessonUploadsByItemId ?? {})) {
        revokeInlineQueueObjectUrls(v?.inlineImages ?? {});
      }
      revokeInlineQueueObjectUrls(pendingCourseAboutInlineImages ?? {});
      setPendingLessonUploadsByItemId({});
      setPendingCourseAboutInlineImages({});
      await runStep("Publishing course", () => fetchJson(`/api/v2/courses/${id}/publish`, { method: "POST" }));
      const finalSlug = saved.slug ?? slug;
      setSlug(finalSlug);
      setStatus("published");
      savedMembersSignatureRef.current = getMembersSignature();

      savedSnapshotRef.current = {
        courseId: id,
        status: "published",
        title,
        slug: finalSlug,
        isSlugManuallyEdited,
        aboutHtml: aboutFinal,
        excerpt,
        difficulty,
        whatWillLearn,
        hours,
        minutes,
        materialsIncluded,
        requirements,
        videoProvider,
        videoUrl,
        thumbnailUrl,
        selectedMemberIds: [...selectedMemberIds],
        topics: deepClone(syncedTopics),
      };
      savedSignatureRef.current = JSON.stringify({
        courseId: id,
        status: "published",
        title,
        slug: finalSlug,
        isSlugManuallyEdited,
        aboutHtml: aboutFinal,
        excerpt,
        difficulty,
        whatWillLearn,
        hours,
        minutes,
        materialsIncluded,
        requirements,
        videoProvider,
        videoUrl,
        thumbnailUrl,
        members: [...selectedMemberIds].sort(),
        memberDefaultAccess,
        memberAccessSig: [...selectedMemberIds].sort().map((id) => ({ id, access: memberAccessById[id] ?? memberDefaultAccess })),
        topicsSig: syncedTopics.map((t) => ({
          id: t.id,
          title: t.title,
          summary: t.summary ?? null,
          position: t.position,
          items: (t.items ?? []).map((it) => ({
            id: it.id,
            item_type: it.item_type,
            title: it.title ?? null,
            is_required: Boolean((it as { is_required?: unknown }).is_required),
            position: it.position,
            payload_json: it.payload_json ?? {},
          })),
        })),
        pendingDeletedTopicIds: [],
        pendingDeletedItemIds: [],
        uploadSig: [],
        hasIntroVideoFile: false,
        hasThumbnailFile: false,
      });

      const navigateTo = opts?.afterSuccessNavigateTo ?? null;
      const showSuccessModal = opts?.showSuccessModal ?? !navigateTo;
      if (navigateTo) {
        router.push(navigateTo);
        return;
      }

      if (showSuccessModal) {
        setSuccessModal({
          title: wasPublished ? "Course republished" : "Course published",
          description: wasPublished ? "Your updates are now live for learners." : "Your course has been published successfully.",
        });
      }
      if (mode === "create") {
        router.replace(`/org/${orgSlug}/courses/${id}/edit-v2`);
      } else {
        router.refresh();
      }
    } catch (e) {
      const info = normalizeStepError(e);
      const reportable = isReportableSystemError({ api: info.api, cause: info.cause });
      const supportId = reportable ? (info.api?.supportId ?? generateSupportId()) : null;
      const step = info.step;
      const userMessage = reportable
        ? `${step ? `${step} failed.` : "Something went wrong."} Please report this error to Support.`
        : `${step ? `${step}: ` : ""}${info.cause instanceof Error ? info.cause.message : "Failed to publish course."}`;

      setErrorWithSupport({
        message: userMessage,
        step,
        supportId,
        canReport: reportable,
        reportPayload: reportable
          ? buildReportPayload({
              supportId: supportId ?? generateSupportId(),
              step,
              context: { action: "publish_course", course_id: courseIdForContext, mode, status, was_published: wasPublished },
              cause: info.cause,
              api: info.api,
            })
          : null,
      });
    } finally {
      setIsBusy(false);
      busyActionRef.current = null;
      setBusyAction(null);
      setBusyStep(null);
      setBusyVisitedSteps([]);
    }
  }

  async function deleteCourseHard() {
    if (!courseId) return;
    if (deleteCourseConfirmText !== "DELETE") {
      toast.error('Type "DELETE" to confirm course deletion.');
      return;
    }

    setError(null);
    setIsBusy(true);
    busyActionRef.current = "delete_course";
    setBusyAction("delete_course");
    setBusyStep("Deleting course");
    setBusyVisitedSteps([]);

    try {
      await fetchJson(`/api/v2/courses/${courseId}`, { method: "DELETE" });
      discardAllChanges();
      setDeleteCourseOpen(false);
      toast.success("Course deleted. Issued certificates remain available.");
      router.push(backHref);
    } catch (e) {
      const info = normalizeStepError(e);
      const reportable = isReportableSystemError({ api: info.api, cause: info.cause });
      const supportId = reportable ? (info.api?.supportId ?? generateSupportId()) : null;
      const message = reportable
        ? "Course deletion failed. Please report this error to Support."
        : (info.api?.message ?? (info.cause instanceof Error ? info.cause.message : "Failed to delete course."));

      setErrorWithSupport({
        message,
        step: "Deleting course",
        supportId,
        canReport: reportable,
        reportPayload: reportable
          ? buildReportPayload({
              supportId: supportId ?? generateSupportId(),
              step: "Deleting course",
              context: { action: "delete_course", course_id: courseId, mode, status },
              cause: info.cause,
              api: info.api,
            })
          : null,
      });
    } finally {
      setIsBusy(false);
      busyActionRef.current = null;
      setBusyAction(null);
      setBusyStep(null);
      setBusyVisitedSteps([]);
    }
  }

  async function createOrUpdateTopic() {
    if (!topicModal) return;
    setError(null);
    try {
      if (topicModal.mode === "create") {
        const newTopicId = makeTempId("tmp_topic");
        setTopics((prev) => [
          ...prev,
          {
            id: newTopicId,
            title: topicModal.title.trim() || "New chapter",
            summary: topicModal.summary?.trim() || null,
            position: prev.length,
            items: [],
          },
        ]);
        setTopicExpanded(newTopicId, true);
        toast.info("Chapter added locally. Click Save to apply changes.");
      } else if (topicModal.topicId) {
        setTopics((prev) =>
          prev.map((t) =>
            t.id === topicModal.topicId
              ? { ...t, title: topicModal.title.trim() || t.title, summary: topicModal.summary?.trim() || null }
              : t
          )
        );
        toast.info("Chapter updated locally. Click Save to apply changes.");
      }
      setTopicModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save chapter.");
    }
  }

  async function deleteTopic(topicId: string) {
    if (!confirm("Delete this chapter and all content inside it?")) return;
    setError(null);
    setIsBusy(true);
    try {
      setTopics((prev) => prev.filter((t) => t.id !== topicId));
      setTopicExpanded(topicId, false);
      if (!isTempId(topicId)) {
        setPendingDeletedTopicIds((prev) => (prev.includes(topicId) ? prev : [...prev, topicId]));
      }
      toast.info("Chapter removed locally. Click Save to apply changes.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete chapter.");
    } finally {
      setIsBusy(false);
    }
  }

  async function deleteTopicItem(topicId: string, itemId: string) {
    if (!confirm("Delete this content item?")) return;
    setError(null);
    setIsBusy(true);
    try {
      setTopics((prev) => prev.map((t) => (t.id === topicId ? { ...t, items: t.items.filter((i) => i.id !== itemId) } : t)));
      if (!isTempId(itemId)) {
        setPendingDeletedItemIds((prev) => (prev.includes(itemId) ? prev : [...prev, itemId]));
      }
      toast.info("Item removed locally. Click Save to apply changes.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete item.");
    } finally {
      setIsBusy(false);
    }
  }

  async function saveLesson() {
    if (!itemModal || itemModal.itemType !== "lesson") return;
    setError(null);
    try {
      const normalizedBlocks = (itemModal.contentBlocks ?? []).map((b) => ({ ...b, html: (b?.html ?? "") }));
      const persistedBlocks = normalizedBlocks.map((b) => b.html);
      const joinedHtml = joinLessonBlocksHtml(normalizedBlocks);

      const basePayload: Record<string, unknown> = {
        kind: "lesson_v1",
        lesson_name: itemModal.lessonName.trim() || "Draft Lesson",
        content_blocks: persistedBlocks,
        content_html: joinedHtml,
        feature_image: itemModal.featureImageStoragePath
          ? { storage_path: itemModal.featureImageStoragePath }
          : null,
        video: itemModal.videoProvider === "html5"
          ? (itemModal.videoStoragePath ? { provider: "html5", storage_path: itemModal.videoStoragePath } : { provider: "html5" })
          : { provider: itemModal.videoProvider, url: itemModal.videoUrl.trim() || null },
        playback_time: { hours: Math.max(0, itemModal.playbackHours || 0), minutes: Math.min(59, Math.max(0, itemModal.playbackMinutes || 0)) },
        attachments: itemModal.existingAttachments ?? [],
      };

      const lessonTitle = itemModal.lessonName.trim() || "Draft Lesson";
      const localItemId = itemModal.mode === "create" ? makeTempId("tmp_item") : (itemModal.itemId as string);

      const nextItem: CourseTopicItem = {
        id: localItemId,
        item_type: "lesson",
        title: lessonTitle,
        position: 0,
        payload_json: basePayload,
      };

      setTopics((prev) =>
        prev.map((t) => {
          if (t.id !== itemModal.topicId) return t;
          if (itemModal.mode === "create") {
            const pos = t.items.length;
            return { ...t, items: [...t.items, { ...nextItem, position: pos }] };
          }
          return { ...t, items: t.items.map((it) => (it.id === localItemId ? { ...nextItem, position: it.position } : it)) };
        })
      );

      setPendingLessonUploadsByItemId((prev) => ({
        ...prev,
        [localItemId]: (() => {
          const existing = prev[localItemId] ?? null;

          // Preserve any already-pending uploads unless the user explicitly selects new files.
          const featureImageFile = itemModal.featureImageFile ?? existing?.featureImageFile ?? null;
          const videoFile =
            itemModal.videoProvider === "html5"
              ? (itemModal.videoFile ?? existing?.videoFile ?? null)
              : null;
          const attachments = [...(existing?.attachments ?? []), ...(itemModal.attachments ?? [])];

          // Inline images: merge, then keep only those still referenced across ALL lesson blocks.
          const mergedInline = { ...(existing?.inlineImages ?? {}), ...(itemModal.inlineImages ?? {}) };
          const inlineImages = pruneQueueByBlocksWithRevoke(mergedInline, normalizedBlocks);

          return { featureImageFile, videoFile, attachments, inlineImages };
        })(),
      }));

      setItemModal(null);
      toast.info("Lesson updated locally. Click Save to apply changes.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save lesson.");
    }
  }

  function cancelLessonModal() {
    setItemModal((prev) => {
      if (!prev || prev.itemType !== "lesson") return null;
      revokeInlineQueueObjectUrls(prev.inlineImages ?? {});
      return null;
    });
  }

  function upsertQuizLocally(args: { mode: "create" | "edit"; topicId: string; itemId: string | null; title: string; payload_json: Record<string, unknown> }): string {
    const localItemId = args.mode === "create" ? makeTempId("tmp_item") : (args.itemId as string);
    const nextItem: CourseTopicItem = {
      id: localItemId,
      item_type: "quiz",
      title: args.title.trim() || "Draft Quiz",
      position: 0,
      payload_json: args.payload_json,
    };
    setTopics((prev) =>
      prev.map((t) => {
        if (t.id !== args.topicId) return t;
        if (args.mode === "create") {
          const pos = t.items.length;
          return { ...t, items: [...t.items, { ...nextItem, position: pos }] };
        }
        return { ...t, items: t.items.map((it) => (it.id === localItemId ? { ...nextItem, position: it.position } : it)) };
      })
    );
    return localItemId;
  }

  function openEditLesson(topicId: string, item: CourseTopicItem) {
    const p = (item.payload_json ?? {}) as Record<string, unknown>;
    const playback = (p.playback_time ?? {}) as { hours?: unknown; minutes?: unknown };
    const video = (p.video ?? {}) as { provider?: unknown; url?: unknown; storage_path?: unknown };
    const feature = (p.feature_image ?? {}) as { storage_path?: unknown };
    const attachments = Array.isArray(p.attachments) ? (p.attachments as LessonModalState["existingAttachments"]) : [];
    setItemModal({
      itemType: "lesson",
      mode: "edit",
      topicId,
      itemId: item.id,
      lessonName: (item.title ?? (p.lesson_name as string) ?? "").toString(),
      contentBlocks: extractLessonBlocksFromPayload(p),
      inlineImages: {},
      featureImageFile: null,
      featureImagePreviewUrl: null,
      featureImageStoragePath: typeof feature.storage_path === "string" ? feature.storage_path : null,
      videoProvider: (video.provider === "youtube" || video.provider === "vimeo" ? (video.provider as LessonVideoProvider) : "html5"),
      videoUrl: typeof video.url === "string" ? video.url : "",
      videoFile: null,
      videoStoragePath: typeof video.storage_path === "string" ? video.storage_path : null,
      playbackHours: Number.isFinite(Number(playback.hours)) ? Number(playback.hours) : 0,
      playbackMinutes: Number.isFinite(Number(playback.minutes)) ? Number(playback.minutes) : 0,
      attachments: [],
      existingAttachments: attachments,
    });
  }

  function openEditQuiz(topicId: string, item: CourseTopicItem) {
    const p = (item.payload_json ?? {}) as Record<string, unknown>;
    setItemModal({
      itemType: "quiz",
      mode: "edit",
      topicId,
      itemId: item.id,
      title: (item.title ?? (p.title as string) ?? "").toString(),
      summary: typeof p.summary === "string" ? p.summary : "",
      payload_json: (item.payload_json ?? null) as Record<string, unknown> | null,
    });
  }

  function applyLessonFeatureImageFile(file: File | null) {
    if (!file) return;
    const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
    if (!allowed.has(file.type)) {
      toast.error("Invalid feature image type. Allowed: PNG, JPG, WebP.");
      return;
    }
    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      toast.error("Feature image is too large. Max size is 10MB.");
      return;
    }
    setItemModal((prev) => (prev && prev.itemType === "lesson" ? { ...prev, featureImageFile: file } : prev));
  }

  function removeLessonFeatureImage() {
    // Clear input value so selecting the same file again re-triggers onChange.
    try {
      const el = document.getElementById("lesson-feature-image-input") as HTMLInputElement | null;
      if (el) el.value = "";
    } catch {
      // ignore
    }

    // Clear modal state (preview + file + persisted storage path).
    setItemModal((prev) => {
      if (!prev || prev.itemType !== "lesson") return prev;
      return { ...prev, featureImageFile: null, featureImagePreviewUrl: null, featureImageStoragePath: null };
    });

    // If there was already a pending upload queued for this item, explicitly clear it
    // so "remove" wins over the "preserve pending uploads" rule.
    if (itemModal && itemModal.itemType === "lesson" && itemModal.mode === "edit" && itemModal.itemId) {
      const id = itemModal.itemId;
      setPendingLessonUploadsByItemId((prev) => {
        const existing = prev[id];
        if (!existing) return prev;
        return { ...prev, [id]: { ...existing, featureImageFile: null } };
      });
    }
  }

  function applyLessonVideoFile(file: File | null) {
    if (!file) return;
    if (file.type !== "video/mp4") {
      toast.error("Invalid video type. Allowed: MP4.");
      return;
    }
    const maxBytes = 300 * 1024 * 1024;
    if (file.size > maxBytes) {
      toast.error("Video is too large. Max size is 300MB.");
      return;
    }
    setItemModal((prev) => (prev && prev.itemType === "lesson" ? { ...prev, videoFile: file } : prev));
  }

  function applyLessonAttachmentFiles(files: File[]) {
    const maxFiles = 10;
    const maxBytesPerFile = 300 * 1024 * 1024;
    if (files.length > maxFiles) {
      toast.error("Too many attachments. Max 10 files.");
      return;
    }
    for (const f of files) {
      if (f.size > maxBytesPerFile) {
        toast.error(`Attachment too large: ${f.name} (max 300MB).`);
        return;
      }
    }
    setItemModal((prev) => (prev && prev.itemType === "lesson" ? { ...prev, attachments: files } : prev));
  }

  async function onTopicDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = topics.findIndex((t) => t.id === active.id);
    const newIndex = topics.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = topics.slice();
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    const withPosition = next.map((t, idx) => ({ ...t, position: idx }));
    setTopics(withPosition);
  }

  return (
    <div
      className="cb-form mx-auto w-full space-y-5"
      style={{ minHeight: "100vh" }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border bg-white px-4 py-3"
        style={{ boxShadow: "0 2px 16px rgba(27,135,85,0.1)", borderColor: "rgba(27,135,85,0.15)" }}
      >
        <div className="text-xl text-foreground font-semibold">
          Course Builder
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!canPreview}
            title={!previewHref ? "Save the course first to enable preview." : hasUnsavedChanges ? "Save changes to preview the latest version." : "Preview course"}
            onClick={() => {
              if (!previewHref) {
                toast.info("Save the course first to enable preview.");
                return;
              }
              if (hasUnsavedChanges) {
                toast.info("You have unsaved changes. Save to preview the latest version.");
                return;
              }
              window.open(previewHref, "_blank", "noopener,noreferrer");
            }}
          >
            <ExternalLink className="h-4 w-4" />
            Preview
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void (status === "published" ? savePublished() : saveDraft());
            }}
            disabled={isBusy || !canSave}
          >
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
          {status === "published" ? (
            <Button
              type="button"
              disabled
              className="bg-green-600 text-white hover:bg-green-600 disabled:opacity-100 disabled:pointer-events-none"
            >
              <Check className="h-4 w-4" />
              Published
            </Button>
          ) : (
            <Button type="button" onClick={() => void publishCourse()} disabled={isBusy || !canPublish}>
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Publish
            </Button>
          )}
          {status === "published" ? (
            <Button type="button" variant="outline" disabled={isBusy} onClick={() => setConfirmUnpublishDraftOpen(true)}>
              Unpublish
            </Button>
          ) : null}
          {mode === "edit" && courseId ? (
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
              onClick={() => {
                setDeleteCourseConfirmText("");
                setDeleteCourseOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          ) : null}
          <Button
            variant="ghost"
            type="button"
            size="icon-sm"
            aria-label="Back"
            title="Back"
            onClick={() => {
              if (hasUnsavedChanges) {
                setLeavePrompt({ href: backHref });
                return;
              }
              router.push(backHref);
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div>{error}</div>
              {errorStep ? <div className="mt-1 text-xs text-muted-foreground">Step: {errorStep}</div> : null}
              {errorSupportId ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  Support ID: <span className="font-mono">{errorSupportId}</span>
                </div>
              ) : null}
            </div>

            {errorCanReport ? (
              <div className="shrink-0 flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void reportCurrentError()}
                  disabled={errorReportSending || errorReportSent}
                >
                  {errorReportSent ? "Reported" : (errorReportSending ? "Reporting..." : "Report error")}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {hasUnsavedChanges ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900">
          You have unsaved changes. Click <span className="font-medium">Save</span> to apply them.
        </div>
      ) : null}

      <div
        style={{
          // background: "linear-gradient(135deg, #c8edd8 0%, #b3e5c4 50%, #a5deb8 100%)",
          borderRadius: "18px",
          padding: "10px",
          boxShadow: "0 6px 24px rgba(245,129,49,0.18), 0 2px 8px rgba(0,0,0,0.06)",
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          {/* Course Information Tab */}
          <button
            type="button"
            onClick={() => setActiveMainTab("information")}
            style={activeMainTab === "information" ? {
              background: "linear-gradient(-135deg, #FFB972 0%, #F58131 50%, #D85B12 100%)",
              backgroundSize: "200% 200%",
              animation: "cb-gradient-shift 8s ease infinite",
              boxShadow: "0 8px 24px rgba(245,129,49,0.42), 0 2px 8px rgba(0,0,0,0.12)",
              border: "1px solid rgba(255,255,255,0.35)",
              color: "#ffffff",
              borderRadius: "12px",
              padding: "14px 18px",
              textAlign: "left",
              cursor: "pointer",
              transform: "translateY(-1px)",
              width: "100%",
            } : {
              background: "rgba(255,255,255,0.82)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
              border: "1px solid rgba(255,255,255,0.6)",
              color: "#374151",
              borderRadius: "12px",
              padding: "14px 18px",
              textAlign: "left",
              cursor: "pointer",
              width: "100%",
              opacity: 0.85,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "3px" }}>📋 Course Information</div>
            <div style={{ fontSize: "11px", opacity: 0.8 }}>General setup, metadata, access and publishing settings.</div>
          </button>

          {/* Course Builder Tab */}
          <button
            type="button"
            onClick={() => setActiveMainTab("builder")}
            style={activeMainTab === "builder" ? {
              background: "linear-gradient(135deg, #FFB972 0%, #F58131 50%, #D85B12 100%)",
              backgroundSize: "200% 200%",
              animation: "cb-gradient-shift 8s ease infinite",
              boxShadow: "0 8px 24px rgba(245,129,49,0.42), 0 2px 8px rgba(0,0,0,0.12)",
              border: "1px solid rgba(255,255,255,0.35)",
              color: "#ffffff",
              borderRadius: "12px",
              padding: "14px 18px",
              textAlign: "left",
              cursor: "pointer",
              transform: "translateY(-1px)",
              width: "100%",
            } : {
              background: "rgba(255,255,255,0.82)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
              border: "1px solid rgba(255,255,255,0.6)",
              color: "#374151",
              borderRadius: "12px",
              padding: "14px 18px",
              textAlign: "left",
              cursor: "pointer",
              width: "100%",
              opacity: 0.85,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "3px" }}>🏗️ Course Builder</div>
            <div style={{ fontSize: "11px", opacity: 0.8 }}>Build chapters, lessons and quizzes in your learning flow.</div>
          </button>
        </div>
      </div>

      {activeMainTab === "information" ? <DetailsSection title="Course Info">
        <div className="space-y-6">
          <div>
            <FieldLabel required>Course Title</FieldLabel>
            <Input
            value={title}
            onChange={(e) => {
              const nextTitle = e.target.value;
              setTitle(nextTitle);
              if (!isSlugManuallyEdited) {
                setSlug(normalizeSlug(nextTitle));
              }
            }}
              placeholder="Enter a clear course name (e.g. WordPress SEO Fundamentals)"
            />
            <FieldHint>This is the main course title shown to learners in course listings and on the course page.</FieldHint>
          </div>

          <div>
            <FieldLabel required>Course Slug</FieldLabel>
            <Input
            value={slug}
            onChange={(e) => {
              const raw = e.target.value;
              if (!raw.trim()) {
                setSlug("");
                setIsSlugManuallyEdited(false);
                return;
              }
              setSlug(normalizeSlug(raw));
              setIsSlugManuallyEdited(true);
            }}
            placeholder="course-url-slug"
            />
            <FieldHint>Lowercase letters, numbers and dashes only.</FieldHint>
          </div>

          <div className="text-sm">
            <span className="text-muted-foreground">Permalink: </span>
            <span className="font-medium break-all">{permalink || "Will be generated from course name"}</span>
          </div>

          <div>
            <FieldLabel>About Course</FieldLabel>
            <RichTextEditorWithUploads
              value={aboutHtml}
              onChange={(html) => {
                setAboutHtml(html);
                setPendingCourseAboutInlineImages((prev) => pruneQueueByHtml(prev ?? {}, html));
              }}
              placeholder="Write a detailed course description for visitors before enrollment."
              queue={pendingCourseAboutInlineImages}
              setQueue={(updater) => {
                setPendingCourseAboutInlineImages((prev) => {
                  const next = typeof updater === "function" ? updater(prev ?? {}) : updater;
                  return next ?? {};
                });
              }}
            />
            <FieldHint>This detailed description is visible to users before they enroll in the course.</FieldHint>
          </div>

          <div>
            <FieldLabel>Excerpt</FieldLabel>
            <Textarea
              value={excerpt}
              onChange={(e) => {
                setExcerpt(e.target.value.slice(0, 200));
              }}
              placeholder="Write a short summary shown in course lists."
              className="min-h-[90px]"
            />
            <div className="flex items-center justify-between">
              <FieldHint>Short preview text shown under the course card image.</FieldHint>
              <p className="text-xs text-muted-foreground">{excerpt.length}/200</p>
            </div>
          </div>
        </div>
      </DetailsSection> : null}

      {activeMainTab === "information" ? <DetailsSection title="Video">
        <div className="space-y-6">
          <div>
            <FieldLabel accent="#1b6bb8">Course Intro Video</FieldLabel>
            <select
              className="h-10 w-full rounded-md border bg-transparent px-3 text-sm"
              value={videoProvider}
              onChange={(e) => {
                setVideoProvider(e.target.value as "html5" | "youtube" | "vimeo");
                setVideoFile(null);
              }}
            >
              <option value="html5">HTML 5 (mp4)</option>
              <option value="youtube">YouTube</option>
              <option value="vimeo">Vimeo</option>
            </select>
            <FieldHint>Select where intro video is sourced from (file upload or full external URL).</FieldHint>
          </div>

          {videoProvider === "html5" ? (
            <div>
              <div
                role="button"
                tabIndex={0}
                onClick={() => videoInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    videoInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsVideoDragActive(true);
                }}
                onDragLeave={() => setIsVideoDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsVideoDragActive(false);
                  const file = e.dataTransfer.files?.[0] ?? null;
                  applyVideoFile(file);
                }}
                className={cn(
                  "rounded-md border border-dashed border-primary bg-muted/10 p-10 text-center transition-colors cursor-pointer",
                  isVideoDragActive ? "border-primary bg-primary/5" : ""
                )}
              >
                <p className="text-sm font-medium">Drag & Drop Your Video</p>
                <p className="mt-1 text-xs text-muted-foreground">File format: .mp4 • Max size: 300MB</p>
                <div className="mt-4">
                  <Button type="button" variant="outline" size="sm" onClick={() => videoInputRef.current?.click()}>
                    Browse file
                  </Button>
                </div>
                {videoFile ? <p className="mt-3 text-xs text-muted-foreground">Selected: {videoFile.name}</p> : null}
              </div>
              <Input
                ref={videoInputRef}
                type="file"
                accept="video/mp4"
                className="hidden"
                onChange={(e) => applyVideoFile(e.target.files?.[0] ?? null)}
              />
            </div>
          ) : (
            <div>
              <FieldLabel accent="#1b6bb8">External URL</FieldLabel>
              <div className="mt-2 rounded-md border border-dashed border-primary bg-muted/10 p-4">
                <Input
                  value={videoUrl}
                  onChange={(e) => {
                    setVideoUrl(e.target.value);
                  }}
                  placeholder={`Paste ${videoProvider === "youtube" ? "YouTube" : "Vimeo"} video URL`}
                />
              </div>
              <FieldHint>Provide the full share URL for the selected provider.</FieldHint>
            </div>
          )}
        </div>
      </DetailsSection> : null}

      {activeMainTab === "information" ? <DetailsSection title="Course Thumbnail">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="w-full md:w-[300px]">
            <div
              role="button"
              tabIndex={0}
              onClick={() => thumbnailInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  thumbnailInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsThumbnailDragActive(true);
              }}
              onDragLeave={() => setIsThumbnailDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsThumbnailDragActive(false);
                const file = e.dataTransfer.files?.[0] ?? null;
                void applyThumbnailFile(file);
              }}
              className={cn(
                "relative h-[180px] cursor-pointer rounded-md border border-dashed flex items-center justify-center overflow-hidden bg-muted/10 transition-colors",
                (thumbnailObjectUrl || thumbnailUrl) ? "border-solid" : "",
                isThumbnailDragActive ? "border-primary bg-primary/5" : ""
              )}
            >
              {thumbnailObjectUrl || thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbnailObjectUrl ?? thumbnailUrl} alt="Course thumbnail preview" className="h-full w-full object-cover" />
              ) : (
                <div className="px-3 text-center">
                  <div className="mx-auto mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-background/80 text-muted-foreground ring-1 ring-border">
                    <ImageIcon className="h-5 w-5" />
                  </div>
                  <p className="text-xs text-muted-foreground">Drop or choose image</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Click here or drag file into this area</p>
                </div>
              )}

              {thumbnailObjectUrl || thumbnailUrl ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Remove thumbnail"
                  title="Remove thumbnail"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeThumbnailLocal();
                  }}
                  className="absolute right-2 top-2 bg-background/80 hover:bg-background text-destructive"
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
            <Input
              ref={thumbnailInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => void applyThumbnailFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Size:</span> 700×430 pixels
              </div>
              <div>
                <span className="font-medium text-foreground">File support:</span> PNG, JPG, WebP
              </div>
              <div className="text-xs">Maximum upload size: 10MB</div>
            </div>
          </div>
        </div>
      </DetailsSection> : null}

      {activeMainTab === "information" ? <DetailsSection title="Course Settings" allowOverflow>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-1 rounded-md border bg-muted/10 p-3">
            <div className="flex items-center gap-2 rounded-md bg-background border px-3 py-2 text-sm font-medium">
              <Settings className="h-4 w-4 text-muted-foreground" />
              General
            </div>
          </div>
          <div className="md:col-span-2 space-y-6">
            <div className="relative">
              <FieldLabel accent="#b87216">Members</FieldLabel>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!courseId || isBusy || csvPreviewLoading || csvApplyLoading}
                  onClick={downloadAssignmentCsvTemplate}
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Export CSV Template
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!courseId || isBusy || csvPreviewLoading || csvApplyLoading}
                  onClick={openCsvImportModal}
                >
                  <Upload className="h-4 w-4" />
                  Import CSV
                </Button>
                {!courseId ? <span className="text-xs text-muted-foreground">Save the course first to enable CSV import/export.</span> : null}
              </div>
              <div className="mt-3 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
                <p>Export the CSV template first, then update one row per user for this course.</p>
                <p>* Do not rename or delete columns. Required columns are <code>user_id</code>, <code>email</code>, <code>full_name</code>, <code>course_id</code>, <code>course_name</code>, <code>assigned</code>, and <code>tfa</code>.</p>
                <p>* <code>assigned=true</code> assigns or updates access. <code>assigned=false</code> removes access.</p>
                <p>* Allowed <code>tfa</code> values are <code>unlimited</code>, <code>3m</code>, <code>1m</code>, and <code>1w</code>.</p>
                <p>* <code>course_id</code> must not be changed. <code>course_name</code> is for admin reference only.</p>
              </div>
              <button
                type="button"
                className="mt-1 w-full h-10 rounded-md border bg-background px-3 text-left text-sm flex items-center justify-between hover:bg-muted/10 transition-colors cursor-pointer"
                onClick={() => {
                  memberAccessPreviewEpochMsRef.current = Date.now();
                  setMembersOpen((v) => !v);
                }}
              >
                <span className="truncate">{selectedMemberIds.size > 0 ? `${selectedMemberIds.size} member(s) selected` : "Select members"}</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
              <FieldHint>Select which members should have access to this course (default: none selected).</FieldHint>

              {membersOpen ? (
                <div className="absolute z-20 mt-2 w-full rounded-md border bg-card shadow-lg p-3 space-y-2">
                  <Input value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} placeholder="Search members..." />
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">Time for access (applied when selecting members)</div>
                    <select
                      className="h-9 rounded-md border bg-background px-2 text-sm hover:cursor-pointer"
                      value={memberDefaultAccess}
                      onChange={(e) => setMemberDefaultAccess(e.target.value as AccessDurationKey)}
                    >
                      {ACCESS_DURATION_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {accessKeyLabel(k)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSelectedMemberIds((prev) => {
                          const next = new Set(prev);
                          for (const m of filteredMembers) {
                            if (checked) next.add(m.id);
                            else next.delete(m.id);
                          }
                          return next;
                        });
                        setMemberAccessById((prev) => {
                          const next = { ...prev };
                          for (const m of filteredMembers) {
                            if (checked) next[m.id] = next[m.id] ?? memberDefaultAccess;
                            else delete next[m.id];
                          }
                          return next;
                        });
                      }}
                    />
                    Select all in current search
                  </label>
                  <div className="max-h-56 overflow-auto space-y-1 border rounded-md p-2 bg-background">
                    {filteredMembers.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No members found.</p>
                    ) : (
                      filteredMembers.map((m) => (
                        <label key={m.id} className="flex items-center gap-2 text-sm rounded-md px-2 py-1 hover:bg-muted/10 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedMemberIds.has(m.id)}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setSelectedMemberIds((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(m.id);
                                else next.delete(m.id);
                                return next;
                              });
                              setMemberAccessById((prev) => {
                                const next = { ...prev };
                                if (checked) next[m.id] = next[m.id] ?? memberDefaultAccess;
                                else delete next[m.id];
                                return next;
                              });
                            }}
                          />
                          <span className="truncate">{m.label}</span>
                          {selectedMemberIds.has(m.id) ? (
                            <span className="ml-auto inline-flex items-center gap-2">
                              {(() => {
                                const baselineIso = baselineMemberExpiresAtById[m.id] ?? null;
                                const selectedKey = memberAccessById[m.id] ?? memberDefaultAccess;
                                const baselineKeyRaw = (initialCourse?.assigned_member_access ?? {})[m.id];
                                const baselineKey: AccessDurationKey = isAccessDurationKey(baselineKeyRaw) ? baselineKeyRaw : "unlimited";
                                const isNewOrChanged = !baselineMemberExpiresAtById[m.id] || selectedKey !== baselineKey;

                                const nowMs = Date.now();
                                const iso = isNewOrChanged
                                  ? computeAccessExpiresAt(selectedKey, new Date(memberAccessPreviewEpochMsRef.current))
                                  : baselineIso;

                                if (!iso) {
                                  return <span className="text-[10px] text-muted-foreground">Unlimited</span>;
                                }

                                const ms = new Date(iso).getTime();
                                const expired = Number.isFinite(ms) ? ms <= nowMs : false;
                                const label = `${isNewOrChanged ? "Will expire" : expired ? "Expired" : "Expires"} ${formatExpiresChip(iso)}`;
                                return (
                                  <span className={`text-[10px] ${expired ? "text-destructive" : "text-muted-foreground"}`}>
                                    {label}
                                  </span>
                                );
                              })()}
                              <select
                                className="h-8 rounded-md border bg-background px-2 text-xs hover:cursor-pointer"
                                value={memberAccessById[m.id] ?? "unlimited"}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const v = e.target.value as AccessDurationKey;
                                  setMemberAccessById((prev) => ({ ...prev, [m.id]: v }));
                                }}
                              >
                                {ACCESS_DURATION_KEYS.map((k) => (
                                  <option key={k} value={k}>
                                    {accessKeyLabel(k)}
                                  </option>
                                ))}
                              </select>
                            </span>
                          ) : null}
                        </label>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div>
              <FieldLabel accent="#b87216">Difficulty Level</FieldLabel>
              <select
                className="h-10 w-full rounded-md border bg-transparent px-3 text-sm"
                value={difficulty ?? "all_levels"}
                onChange={(e) => {
                  setDifficulty(e.target.value as CourseV2["difficulty_level"]);
                }}
              >
                <option value="all_levels">All Levels</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="expert">Expert</option>
              </select>
              <FieldHint>Defines the expected skill level for learners taking this course.</FieldHint>
            </div>
          </div>
        </div>
      </DetailsSection> : null}

      {activeMainTab === "builder" ? <DetailsSection title="Course Builder">
        <div className="space-y-3">
          {dndReady ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onTopicDragEnd(e)}>
              <SortableContext items={topics.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {topics.map((topic) => (
                    <SortableTopicRow
                      key={topic.id}
                      topic={topic}
                      expanded={expandedTopicIds.has(topic.id)}
                      onToggle={() => setTopicExpanded(topic.id, !expandedTopicIds.has(topic.id))}
                      onEdit={() =>
                        setTopicModal({
                          mode: "edit",
                          topicId: topic.id,
                          title: topic.title,
                          summary: topic.summary ?? "",
                        })
                      }
                      onDelete={() => void deleteTopic(topic.id)}
                      onEditLessonItem={(topicId, item) => openEditLesson(topicId, item)}
                      onEditQuizItem={(topicId, item) => openEditQuiz(topicId, item)}
                      onReorderItems={reorderItemsLocally}
                      onDeleteItem={(topicId, itemId) => void deleteTopicItem(topicId, itemId)}
                      onAddLesson={() =>
                        setItemModal({
                        itemType: "lesson",
                        mode: "create",
                        topicId: topic.id,
                        itemId: null,
                        lessonName: "Draft Lesson",
                        contentBlocks: [{ id: makeBlockId(), html: "" }],
                        inlineImages: {},
                        featureImageFile: null,
                        featureImagePreviewUrl: null,
                        featureImageStoragePath: null,
                        videoProvider: "html5",
                        videoUrl: "",
                        videoFile: null,
                        videoStoragePath: null,
                        playbackHours: 0,
                        playbackMinutes: 0,
                        attachments: [],
                        existingAttachments: [],
                        })
                      }
                      onAddQuiz={() =>
                        setItemModal({
                        itemType: "quiz",
                        mode: "create",
                        topicId: topic.id,
                        itemId: null,
                        title: "",
                        summary: "",
                        payload_json: null,
                        })
                      }
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="space-y-2">
              {topics.map((topic) => (
                <StaticTopicRow
                  key={topic.id}
                  topic={topic}
                  expanded={expandedTopicIds.has(topic.id)}
                  onToggle={() => setTopicExpanded(topic.id, !expandedTopicIds.has(topic.id))}
                  onEdit={() =>
                    setTopicModal({
                      mode: "edit",
                      topicId: topic.id,
                      title: topic.title,
                      summary: topic.summary ?? "",
                    })
                  }
                  onDelete={() => void deleteTopic(topic.id)}
                  onEditLessonItem={(topicId, item) => openEditLesson(topicId, item)}
                  onEditQuizItem={(topicId, item) => openEditQuiz(topicId, item)}
                  onDeleteItem={(topicId, itemId) => void deleteTopicItem(topicId, itemId)}
                  onAddLesson={() =>
                    setItemModal({
                      itemType: "lesson",
                      mode: "create",
                      topicId: topic.id,
                      itemId: null,
                      lessonName: "Draft Lesson",
                      contentBlocks: [{ id: makeBlockId(), html: "" }],
                      inlineImages: {},
                      featureImageFile: null,
                      featureImagePreviewUrl: null,
                      featureImageStoragePath: null,
                      videoProvider: "html5",
                      videoUrl: "",
                      videoFile: null,
                      videoStoragePath: null,
                      playbackHours: 0,
                      playbackMinutes: 0,
                      attachments: [],
                      existingAttachments: [],
                    })
                  }
                  onAddQuiz={() =>
                    setItemModal({
                      itemType: "quiz",
                      mode: "create",
                      topicId: topic.id,
                      itemId: null,
                      title: "",
                      summary: "",
                      payload_json: null,
                    })
                  }
                />
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() =>
              setTopicModal({
                mode: "create",
                topicId: null,
                title: "",
                summary: "",
              })
            }
            style={{
              display: "inline-flex", alignItems: "center", gap: "8px",
              borderRadius: "10px",
              border: "1.5px solid rgba(27,135,85,0.28)",
              background: "rgba(27,135,85,0.05)",
              padding: "8px 18px",
              fontSize: "13px", fontWeight: 700, color: "#1b8755",
              cursor: "pointer",
              boxShadow: "0 1px 4px rgba(27,135,85,0.1)",
              transition: "all 150ms",
            }}
          >
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 22, height: 22, borderRadius: "6px",
              background: "linear-gradient(135deg, #1b8755, #0e4d2c)",
              boxShadow: "0 2px 6px rgba(27,135,85,0.35)",
              flexShrink: 0,
            }}>
              <Plus className="h-3.5 w-3.5 text-white" />
            </span>
            Add new chapter
          </button>
        </div>
      </DetailsSection> : null}

      {activeMainTab === "information" ? <DetailsSection title="Additional Data">
        <div className="space-y-6">
          <div>
            <FieldLabel accent="#1e6b8c">What Will I Learn?</FieldLabel>
            <Textarea
              value={whatWillLearn}
              onChange={(e) => {
                setWhatWillLearn(e.target.value);
              }}
              placeholder="Describe what learners will gain from this course."
            />
            <FieldHint>Shown to help potential learners understand expected outcomes.</FieldHint>
          </div>

          <div>
            <FieldLabel accent="#1e6b8c">Total Course Duration</FieldLabel>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Input
                  type="number"
                  min={0}
                  max={999}
                  value={hours}
                  onChange={(e) => {
                    setHours(Math.max(0, Number(e.target.value || 0)));
                  }}
                  placeholder="Hours"
                />
                <FieldHint>Total hours for this course.</FieldHint>
              </div>
              <div>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={minutes}
                  onChange={(e) => {
                    setMinutes(Math.min(59, Math.max(0, Number(e.target.value || 0))));
                  }}
                  placeholder="Minutes"
                />
                <FieldHint>Additional minutes for this course.</FieldHint>
              </div>
            </div>
          </div>

          <div>
            <FieldLabel accent="#1e6b8c">Materials Included</FieldLabel>
            <Textarea
              value={materialsIncluded}
              onChange={(e) => {
                setMaterialsIncluded(e.target.value);
              }}
              placeholder="Describe included materials, resources or downloads."
            />
            <FieldHint>Displayed on the course page so learners know what materials are included.</FieldHint>
          </div>

          <div>
            <FieldLabel accent="#1e6b8c">Requirements/Instructions</FieldLabel>
            <Textarea
              value={requirements}
              onChange={(e) => {
                setRequirements(e.target.value);
              }}
              placeholder="Add prerequisites or important instructions before learners start."
            />
            <FieldHint>Use this field to list prerequisites, setup, or mandatory learner instructions.</FieldHint>
          </div>
        </div>
      </DetailsSection> : null}

      {activeMainTab === "information" ? (
        <DetailsSection title="Certificate">
          <div className="space-y-6">
            {!courseId ? (
              <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
                Create the course draft first to configure the certificate.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 30,
                          height: 30,
                          borderRadius: "10px",
                          background: "linear-gradient(135deg, #1b8755, #0e4d2c)",
                          boxShadow: "0 2px 10px rgba(27,135,85,0.28)",
                          flexShrink: 0,
                        }}
                      >
                        <Award className="h-4 w-4 text-white" />
                      </span>
                      <div className="font-semibold text-foreground">Auto-grant certificates</div>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Certificates are auto-granted only when the passing grade is greater than 0 and both a template + name placement are configured.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Status:</span>
                    <span className="rounded-full border px-2 py-0.5 text-xs font-medium">
                      {certPassingPercent <= 0
                        ? "Disabled (Passing Grade = 0)"
                        : !certTemplate
                          ? "Needs template"
                          : !certPlacement
                            ? "Needs placement"
                            : "Active"}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <div className="space-y-6">
                    <div>
                      <FieldLabel>Certificate Title</FieldLabel>
                      <Input
                        value={certTitle}
                        onChange={(e) => setCertTitle(e.target.value)}
                        placeholder="e.g. Certificate of Completion"
                        disabled={certLoading || certSaving}
                      />
                      <FieldHint>Displayed in the Certificates area and used as the default generated file name.</FieldHint>
                    </div>

                    <div>
                      <FieldLabel>Course Passing Grade (%)</FieldLabel>
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={certPassingPercentInput}
                        onChange={(e) => {
                          const next = sanitizePercentIntText(e.target.value);
                          setCertPassingPercentInput(next);
                          setCertPassingPercent(coercePercentInt(next));
                        }}
                        onBlur={() => {
                          if (!certPassingPercentInput.trim()) {
                            setCertPassingPercentInput("0");
                            setCertPassingPercent(0);
                          } else {
                            const next = sanitizePercentIntText(certPassingPercentInput);
                            setCertPassingPercentInput(next || "0");
                            setCertPassingPercent(coercePercentInt(next));
                          }
                        }}
                        placeholder="0"
                        disabled={certLoading || certSaving}
                      />
                      <FieldHint>
                        Calculated across all required quizzes using the learner’s best attempt for each quiz (points-weighted). Set 0 to disable auto-granting.
                      </FieldHint>
                    </div>

                    <div className="rounded-lg border bg-muted/10 px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
                      {certAutoStatus === "saving" || certSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {certAutoStatus === "saved" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : null}
                      {certAutoStatus === "saving" || certSaving
                        ? "Saving…"
                        : certAutoStatus === "saved"
                          ? "Saved"
                          : certAutoStatus === "error"
                            ? "Couldn’t save certificate settings. Check your connection."
                            : "Changes save automatically."}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-xl border bg-background p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-foreground">Template file</div>
                          <div className="text-xs text-muted-foreground">Upload a PDF or image template (max 10MB).</div>
                        </div>
                        {certTemplate ? (
                          <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                            {certTemplate.mime_type === "application/pdf" ? "PDF" : "Image"}
                          </span>
                        ) : null}
                      </div>

                      {certTemplate ? (
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-4">
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => certTplInputRef.current?.click()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                certTplInputRef.current?.click();
                              }
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              setIsCertTplDragActive(true);
                            }}
                            onDragLeave={() => setIsCertTplDragActive(false)}
                            onDrop={(e) => {
                              e.preventDefault();
                              setIsCertTplDragActive(false);
                              const f = e.dataTransfer.files?.[0] ?? null;
                              if (f) applyCertificateTemplateFile(f);
                            }}
                            className={cn(
                              "rounded-lg border overflow-hidden bg-muted/10 cursor-pointer transition-colors",
                              isCertTplDragActive ? "border-primary bg-primary/5" : null
                            )}
                            title="Click or drop a file to replace"
                          >
                            {certTplPreviewUrl || certTemplate.mime_type.startsWith("image/") ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                alt="Certificate template preview"
                                src={certTplPreviewUrl ?? `/api/courses/${courseId}/certificate-template?download=1`}
                                className="h-[140px] w-full object-cover"
                              />
                            ) : (
                              <div className="h-[140px] w-full flex items-center justify-center">
                                {certTplUploading ? <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" /> : <FileText className="h-10 w-10 text-muted-foreground" />}
                              </div>
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-foreground truncate">{certTemplate.file_name}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {certTemplate.mime_type} • {Math.round((certTemplate.size_bytes / (1024 * 1024)) * 10) / 10} MB
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={() =>
                                  window.open(
                                    `/api/courses/${courseId}/certificate-template?download=1&preview=1`,
                                    "_blank",
                                    "noopener,noreferrer"
                                  )
                                }
                              >
                                <Eye className="h-4 w-4" />
                                Preview certificate
                              </Button>

                              <Button
                                type="button"
                                size="sm"
                                className="gap-2"
                                onClick={() => setCertPlacementOpen(true)}
                              >
                                🧲 Place member name
                              </Button>

                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={certTplUploading}
                                onClick={() => void deleteCertificateTemplate(courseId)}
                              >
                                {certTplUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                Remove
                              </Button>
                            </div>

                            <div className="mt-3 text-xs">
                              {certPlacement ? (
                                <span className="text-foreground">
                                  Name placement set (page {certPlacement.page}, x {Math.round(certPlacement.xPct * 100)}%, y {Math.round(certPlacement.yPct * 100)}%).
                                </span>
                              ) : (
                                <span className="text-muted-foreground">No name placement set yet. Click “Place member name”.</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => certTplInputRef.current?.click()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              certTplInputRef.current?.click();
                            }
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setIsCertTplDragActive(true);
                          }}
                          onDragLeave={() => setIsCertTplDragActive(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setIsCertTplDragActive(false);
                            const f = e.dataTransfer.files?.[0] ?? null;
                            if (f) applyCertificateTemplateFile(f);
                          }}
                          className={cn(
                            "mt-3 rounded-lg border border-dashed p-8 text-center cursor-pointer transition-colors",
                            isCertTplDragActive ? "border-primary bg-primary/5" : "bg-muted/10"
                          )}
                        >
                          <div className="text-sm font-semibold text-foreground">Drag & drop your certificate template</div>
                          <div className="mt-1 text-xs text-muted-foreground">PDF, PNG, JPG, WebP • Max 10MB</div>
                          <div className="mt-4 inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs font-semibold text-foreground">
                            <Upload className="h-4 w-4" />
                            Browse file
                          </div>
                          {certTplUploading && certTplFile ? (
                            <div className="mt-3 text-xs text-muted-foreground flex items-center justify-center gap-2">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Uploading {certTplFile.name}…
                            </div>
                          ) : null}
                        </div>
                      )}

                      <input
                        ref={certTplInputRef}
                        type="file"
                        accept="application/pdf,image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => applyCertificateTemplateFile(e.target.files?.[0] ?? null)}
                      />
                    </div>
                  </div>
                </div>

                {courseId && certTemplate ? (
                  <CertificatePlacementModal
                    open={certPlacementOpen}
                    templateMime={certTemplate.mime_type}
                    templateDownloadUrl={`/api/courses/${courseId}/certificate-template?download=1`}
                    initialPlacement={certPlacement}
                    onClose={() => setCertPlacementOpen(false)}
                    onSave={(p) => {
                      setCertPlacementOpen(false);
                      setCertPlacement(p);
                    }}
                  />
                ) : null}
              </>
            )}

            {certLoading ? (
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading certificate configuration…
              </div>
            ) : null}
          </div>
        </DetailsSection>
      ) : null}

      {topicModal ? (
        <div className="fixed inset-0 z-1000 bg-black/50 p-4 sm:p-6 overflow-y-auto">
          <div className="min-h-[calc(100svh-2rem)] sm:min-h-[calc(100svh-3rem)] flex items-center justify-center">
            <div className="w-full max-w-xl rounded-lg border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="font-semibold">{topicModal.mode === "create" ? "Add Chapter" : "Edit Chapter"}</h3>
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => setTopicModal(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <FieldLabel required>Chapter Name</FieldLabel>
                <Input
                  value={topicModal.title}
                  onChange={(e) => setTopicModal((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                  placeholder="Name this chapter for your internal course structure"
                />
                <FieldHint>This chapter name is visible to creators in the builder and helps organize course flow.</FieldHint>
              </div>
              <div>
                <FieldLabel>Chapter Summary</FieldLabel>
                <Textarea
                  value={topicModal.summary}
                  onChange={(e) => setTopicModal((prev) => (prev ? { ...prev, summary: e.target.value } : prev))}
                  placeholder="Write a short summary for this chapter"
                  className="min-h-[120px]"
                />
                <FieldHint>Optional summary used in builder previews and internal planning.</FieldHint>
              </div>
            </div>
            <div className="flex items-center justify-between border-t px-4 py-3">
              <Button type="button" variant="outline" onClick={() => setTopicModal(null)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void createOrUpdateTopic()} disabled={isBusy || topicModal.title.trim().length < 2}>
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {topicModal.mode === "create" ? "Add Chapter" : "Save Chapter"}
              </Button>
            </div>
            </div>
          </div>
        </div>
      ) : null}

      {itemModal && itemModal.itemType === "quiz" ? (
        <QuizWizardModal
          mode={itemModal.mode}
          initialTitle={itemModal.title}
          initialSummary={itemModal.summary}
          initialPayloadJson={itemModal.payload_json}
          onClose={() => setItemModal(null)}
          onSave={({ title: quizTitle, payload_json, inline_images }) => {
            const localItemId = upsertQuizLocally({
              mode: itemModal.mode,
              topicId: itemModal.topicId,
              itemId: itemModal.itemId,
              title: quizTitle,
              payload_json,
            });
            if (inline_images && Object.keys(inline_images).length) {
              // Merge into pending uploads for this quiz item so they upload on Save Draft / Publish.
              setPendingLessonUploadsByItemId((prev) => {
                const existing = prev[localItemId] ?? { featureImageFile: null, videoFile: null, attachments: [], inlineImages: {} };
                // Keep only IDs that are still referenced in the quiz payload.
                const keepIds = (() => {
                  try {
                    const p = payload_json as Record<string, unknown>;
                    const questions = Array.isArray(p.questions) ? (p.questions as Array<Record<string, unknown>>) : [];
                    const htmls: string[] = [];
                    const ids = new Set<string>();
                    for (const q of questions) {
                      if (typeof q.description_html === "string") htmls.push(q.description_html);
                      if (typeof q.answer_explanation_html === "string") htmls.push(q.answer_explanation_html);
                      const options = Array.isArray(q.options) ? (q.options as Array<Record<string, unknown>>) : [];
                      for (const option of options) {
                        if (typeof option.image_upload_id === "string" && option.image_upload_id.trim().length > 0) {
                          ids.add(option.image_upload_id.trim());
                        }
                      }
                    }
                    for (const h of htmls) {
                      for (const id of extractInlineUploadIdsFromHtml(h)) ids.add(id);
                    }
                    return ids;
                  } catch {
                    return new Set<string>();
                  }
                })();

                const mergedInline = { ...(existing.inlineImages ?? {}), ...(inline_images ?? {}) };
                const nextInline: PendingLessonUploads["inlineImages"] = {};
                for (const [id, v] of Object.entries(mergedInline)) {
                  if (!keepIds.size || keepIds.has(id)) nextInline[id] = v;
                  else {
                    revokeObjectUrlSafe(v?.objectUrl);
                  }
                }
                return { ...prev, [localItemId]: { ...existing, inlineImages: nextInline } };
              });
            }
            toast.info("Quiz updated locally. Click Save to apply changes.");
          }}
        />
      ) : itemModal ? (
        <div className="fixed inset-0 z-1000 bg-black/50 p-4 sm:p-6 overflow-y-auto">
          <div className="min-h-[calc(100svh-2rem)] sm:min-h-[calc(100svh-3rem)] flex items-center justify-center">
            <div className="w-full max-w-4xl rounded-lg border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="font-semibold">Lesson</h3>
              <Button type="button" size="icon-sm" variant="ghost" onClick={cancelLessonModal}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-4 space-y-6 max-h-[75vh] overflow-auto">
              <>
                  <div>
                    <FieldLabel accent="#1b6bb8" required>Lesson Name</FieldLabel>
                    <Input
                      value={itemModal.lessonName}
                      onChange={(e) =>
                        setItemModal((prev) => (prev && prev.itemType === "lesson" ? { ...prev, lessonName: e.target.value } : prev))
                      }
                      placeholder="Draft Lesson"
                    />
                    <FieldHint>Name shown to learners in the curriculum once enrolled.</FieldHint>
                  </div>

                  <div>
                    <FieldLabel accent="#1b6bb8">Lesson Content</FieldLabel>
                    <div className="mt-2 rounded-lg border bg-muted/10 p-4 space-y-3">
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onLessonBlocksDragEnd}>
                        <SortableContext
                          items={(itemModal.contentBlocks ?? []).map((b) => b.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="space-y-3">
                            {ensureAtLeastOneBlock(itemModal.contentBlocks ?? []).map((b, idx) => (
                              <SortableLessonContentBlockRow
                                key={b.id}
                                block={b}
                                index={idx}
                                queue={itemModal.inlineImages ?? {}}
                                setQueue={(updater) =>
                                  setItemModal((prev) => {
                                    if (!prev || prev.itemType !== "lesson") return prev;
                                    const next = typeof updater === "function" ? updater(prev.inlineImages ?? {}) : updater;
                                    return { ...prev, inlineImages: next ?? {} };
                                  })
                                }
                                onRemove={() => removeLessonContentBlock(b.id)}
                                onChangeHtml={(nextHtml) =>
                                  setItemModal((prev) => {
                                    if (!prev || prev.itemType !== "lesson") return prev;
                                    const blocks = ensureAtLeastOneBlock(prev.contentBlocks ?? []).map((x) =>
                                      x.id === b.id ? { ...x, html: nextHtml } : x
                                    );
                                    const nextInline = pruneQueueByBlocksWithRevoke(prev.inlineImages ?? {}, blocks);
                                    return { ...prev, contentBlocks: blocks, inlineImages: nextInline };
                                  })
                                }
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>

                      <div className="flex items-center justify-end">
                        <Button type="button" size="sm" onClick={addLessonContentBlock} className="gap-2">
                          <Plus className="h-4 w-4" />
                          Add New Content
                        </Button>
                      </div>
                    </div>
                    <FieldHint>
                      Add as many content blocks as you want. You can drag blocks to reorder, remove blocks, and use headings (H1–H6) inside each editor.
                    </FieldHint>
                  </div>

                  <div>
                    <FieldLabel accent="#7c3abd">Feature Image</FieldLabel>
                    <div className="mt-2 rounded-md border p-4 flex flex-col md:flex-row gap-4">
                      <div className="w-full md:w-[300px]">
                        {(() => {
                          const src =
                            itemModal.featureImagePreviewUrl ??
                            (itemModal.featureImageStoragePath
                              ? `/api/v2/lesson-assets?path=${encodeURIComponent(itemModal.featureImageStoragePath)}`
                              : null);

                          return (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            const el = document.getElementById("lesson-feature-image-input") as HTMLInputElement | null;
                            el?.click();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              const el = document.getElementById("lesson-feature-image-input") as HTMLInputElement | null;
                              el?.click();
                            }
                          }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const f = e.dataTransfer.files?.[0] ?? null;
                            applyLessonFeatureImageFile(f);
                          }}
                          className={cn(
                            "relative h-[180px] cursor-pointer rounded-md border border-dashed flex items-center justify-center overflow-hidden bg-muted/10 transition-colors"
                          )}
                        >
                          {src ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={src} alt="Lesson feature image preview" className="h-full w-full object-cover" />
                          ) : (
                            <div className="px-3 text-center">
                              <div className="mx-auto mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-background/80 text-muted-foreground ring-1 ring-border">
                                <ImageIcon className="h-5 w-5" />
                              </div>
                              <p className="text-xs text-muted-foreground">Drop or choose image</p>
                              <p className="mt-1 text-[11px] text-muted-foreground">Click here or drag file into this area</p>
                            </div>
                          )}

                          {src ? (
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Remove feature image"
                              title="Remove feature image"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                removeLessonFeatureImage();
                              }}
                              className="absolute right-2 top-2 bg-background/80 hover:bg-background text-destructive"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                          );
                        })()}
                        <Input
                          id="lesson-feature-image-input"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            applyLessonFeatureImageFile(f);
                          }}
                        />
                      </div>
                      <div className="space-y-3">
                        <div className="text-sm text-muted-foreground">
                          <div>
                            <span className="font-medium text-foreground">Size:</span> 700×430 pixels
                          </div>
                          <div>
                            <span className="font-medium text-foreground">File support:</span> PNG, JPG, WebP
                          </div>
                          <div className="text-xs">Maximum upload size: 10MB</div>
                        </div>
                      </div>
                    </div>
                    <FieldHint>This image can be shown on the lesson header inside the learning experience.</FieldHint>
                  </div>

                  <div>
                    <FieldLabel accent="#1b6bb8">Video Source</FieldLabel>
                    <div className="mt-2 space-y-3">
                      <select
                        className="h-10 w-full rounded-md border bg-transparent px-3 text-sm"
                        value={itemModal.videoProvider}
                        onChange={(e) =>
                          setItemModal((prev) =>
                            prev && prev.itemType === "lesson"
                              ? { ...prev, videoProvider: e.target.value as LessonVideoProvider, videoFile: null }
                              : prev
                          )
                        }
                      >
                        <option value="html5">HTML 5 (mp4)</option>
                        <option value="youtube">YouTube</option>
                        <option value="vimeo">Vimeo</option>
                      </select>

                      {itemModal.videoProvider === "html5" ? (
                        <div className="rounded-md border border-dashed border-primary bg-muted/10 p-10 text-center">
                          <p className="text-sm font-medium">Drag & Drop Your Video</p>
                          <p className="mt-1 text-xs text-muted-foreground">File format: .mp4 • Max size: 300MB</p>
                          <div className="mt-4">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => (document.getElementById("lesson-video-input") as HTMLInputElement | null)?.click()}
                            >
                              Browse file
                            </Button>
                          </div>
                          {itemModal.videoFile ? <p className="mt-3 text-xs text-muted-foreground">Selected: {itemModal.videoFile.name}</p> : null}
                          <Input
                            id="lesson-video-input"
                            type="file"
                            accept="video/mp4"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0] ?? null;
                              applyLessonVideoFile(f);
                            }}
                          />
                        </div>
                      ) : (
                        <div className="rounded-md border border-dashed border-primary bg-muted/10 p-4">
                          <Input
                            value={itemModal.videoUrl}
                            onChange={(e) =>
                              setItemModal((prev) => (prev && prev.itemType === "lesson" ? { ...prev, videoUrl: e.target.value } : prev))
                            }
                            placeholder={`Paste ${itemModal.videoProvider === "youtube" ? "YouTube" : "Vimeo"} video URL`}
                          />
                        </div>
                      )}
                    </div>
                    <FieldHint>Select video source for this lesson. External URLs must be full YouTube/Vimeo links.</FieldHint>
                  </div>

                  <div>
                    <FieldLabel accent="#1b6bb8">Video playback time</FieldLabel>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <Input
                          type="number"
                          min={0}
                          max={999}
                          value={itemModal.playbackHours}
                          onChange={(e) =>
                            setItemModal((prev) =>
                              prev && prev.itemType === "lesson" ? { ...prev, playbackHours: Math.max(0, Number(e.target.value || 0)) } : prev
                            )
                          }
                          placeholder="Hours"
                        />
                        <FieldHint>Hours</FieldHint>
                      </div>
                      <div>
                        <Input
                          type="number"
                          min={0}
                          max={59}
                          value={itemModal.playbackMinutes}
                          onChange={(e) =>
                            setItemModal((prev) =>
                              prev && prev.itemType === "lesson"
                                ? { ...prev, playbackMinutes: Math.min(59, Math.max(0, Number(e.target.value || 0))) }
                                : prev
                            )
                          }
                          placeholder="Minutes"
                        />
                        <FieldHint>Minutes</FieldHint>
                      </div>
                    </div>
                    <FieldHint>Displayed to learners so they know how long the video takes.</FieldHint>
                  </div>

                  <div>
                    <FieldLabel accent="#1b6bb8">Upload exercise files to the Lesson</FieldLabel>
                    <div className="mt-2 flex items-center gap-3">
                      <Input
                        id="lesson-attachments-input"
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          if (!files.length) return;
                          applyLessonAttachmentFiles(files);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => (document.getElementById("lesson-attachments-input") as HTMLInputElement | null)?.click()}
                      >
                        <Paperclip className="h-4 w-4" />
                        Upload Attachments
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        {itemModal.attachments.length
                          ? `${itemModal.attachments.length} file(s) selected`
                          : itemModal.existingAttachments.length
                            ? `${itemModal.existingAttachments.length} existing file(s)`
                            : "No files selected"}
                      </p>
                    </div>
                    <FieldHint>Attach PDFs, worksheets, or other exercise materials for learners.</FieldHint>
                  </div>
              </>
            </div>
            <div className="flex items-center justify-between border-t px-4 py-3">
              <Button type="button" variant="outline" onClick={cancelLessonModal}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void saveLesson()} disabled={isBusy || itemModal.lessonName.trim().length < 2}>
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Update Lesson
              </Button>
            </div>
            </div>
          </div>
        </div>
      ) : null}

      {leavePrompt ? (
        <div className="fixed inset-0 z-1000 bg-black/50 p-4 sm:p-6 overflow-y-auto" data-leave-guard-ignore="true">
          <div className="min-h-[calc(100svh-2rem)] sm:min-h-[calc(100svh-3rem)] flex items-center justify-center">
            <div className="w-full max-w-lg rounded-lg border bg-card shadow-xl">
              <div className="border-b px-4 py-3">
                <h3 className="font-semibold">Unsaved changes</h3>
              </div>
              <div className="p-4 space-y-2 text-sm text-muted-foreground">
                <p>You have unsaved changes in this course.</p>
                <p>Do you want to save before leaving this page?</p>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t px-4 py-3">
                <Button type="button" variant="outline" onClick={() => setLeavePrompt(null)}>
                  Cancel
                </Button>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const href = leavePrompt.href;
                      setLeavePrompt(null);
                      discardAllChanges();
                      router.push(href);
                    }}
                  >
                    Don’t save
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      const href = leavePrompt.href;
                      setLeavePrompt(null);
                      if (status === "published") {
                        void savePublished({ afterSuccessNavigateTo: href });
                      } else {
                        void saveDraft({ afterSuccessNavigateTo: href });
                      }
                    }}
                  >
                    {status === "published" ? "Save & leave" : "Save draft & leave"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {confirmUnpublishDraftOpen ? (
        <div className="fixed inset-0 z-1000 bg-black/50 p-4 sm:p-6 overflow-y-auto" data-leave-guard-ignore="true">
          <div className="min-h-[calc(100svh-2rem)] sm:min-h-[calc(100svh-3rem)] flex items-center justify-center">
            <div className="w-full max-w-lg rounded-lg border bg-card shadow-xl">
              <div className="border-b px-4 py-3">
                <h3 className="font-semibold">Save draft (unpublish)</h3>
              </div>
              <div className="p-4 space-y-2 text-sm text-muted-foreground">
                <p>
                  This course is currently <span className="font-medium text-foreground">Published</span>.
                </p>
                <p>
                  Clicking <span className="font-medium text-foreground">Save Draft</span> will{" "}
                  <span className="font-medium text-foreground">unpublish</span> the course and set it back to{" "}
                  <span className="font-medium text-foreground">Draft</span>.
                </p>
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-900">
                  Learners will no longer be able to access this course until it is published again.
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2 border-t px-4 py-3">
                <Button type="button" variant="outline" disabled={isBusy} onClick={() => setConfirmUnpublishDraftOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    setConfirmUnpublishDraftOpen(false);
                    void saveDraft();
                  }}
                >
                  Unpublish &amp; save draft
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {deleteCourseOpen ? (
        <div className="fixed inset-0 z-1000 bg-black/50 p-4 sm:p-6 overflow-y-auto" data-leave-guard-ignore="true">
          <div className="min-h-[calc(100svh-2rem)] sm:min-h-[calc(100svh-3rem)] flex items-center justify-center">
            <div className="w-full max-w-lg rounded-lg border bg-card shadow-xl">
              <div className="border-b px-4 py-3">
                <h3 className="font-semibold text-red-700">Permanently delete course</h3>
              </div>
              <div className="p-4 space-y-4 text-sm text-muted-foreground">
                <div className="space-y-2">
                  <p>
                    This permanently deletes the course and unfinished learner progress.
                  </p>
                  <p>
                    Issued certificates will remain available to members.
                  </p>
                  <p className="font-medium text-red-700">
                    This cannot be undone.
                  </p>
                </div>
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-900">
                  To confirm, type <span className="font-mono font-semibold">DELETE</span> in uppercase letters.
                </div>
                <Input
                  value={deleteCourseConfirmText}
                  onChange={(e) => setDeleteCourseConfirmText(e.target.value)}
                  placeholder="DELETE"
                  disabled={isBusy}
                  autoFocus
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2 border-t px-4 py-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => {
                    setDeleteCourseOpen(false);
                    setDeleteCourseConfirmText("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={isBusy || deleteCourseConfirmText !== "DELETE"}
                  className="bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  onClick={() => void deleteCourseHard()}
                >
                  {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Permanently delete course
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isBusy && busyAction ? (
        <div className="fixed inset-0 z-1000 bg-black/40 backdrop-blur-sm p-4 sm:p-6 overflow-y-auto" data-leave-guard-ignore="true">
          <div className="min-h-[calc(100svh-2rem)] sm:min-h-[calc(100svh-3rem)] flex items-center justify-center">
            <div className="w-full max-w-md rounded-2xl border bg-card shadow-2xl px-6 py-6">
              {(() => {
                const steps =
                  busyAction === "delete_course"
                    ? [
                        "Deleting course",
                        "Preserving issued certificates",
                        "Cleaning up course assets",
                      ]
                    : busyAction === "publish"
                    ? [
                        "Preparing course",
                        "Saving About Course content",
                        "Saving course details",
                        "Saving members",
                        "Uploading intro video",
                        "Updating thumbnail",
                        "Saving chapters and lessons",
                        "Publishing course",
                      ]
                    : [
                        "Preparing course",
                        "Saving About Course content",
                        "Saving course details",
                        "Saving members",
                        "Uploading intro video",
                        "Updating thumbnail",
                        "Saving chapters and lessons",
                        "Finalizing save",
                      ];

                const title =
                  busyAction === "delete_course"
                    ? "Deleting course…"
                    : busyAction === "publish"
                      ? "Publishing course…"
                      : busyAction === "save_draft"
                        ? "Saving draft…"
                        : "Saving changes…";

                const activeIdx = busyStep ? steps.indexOf(busyStep) : -1;
                const doneCount = steps.filter((s, idx) => busyVisitedSteps.includes(s) || (activeIdx >= 0 && idx < activeIdx)).length;
                const pct = steps.length ? Math.min(100, Math.max(0, Math.round((doneCount / steps.length) * 100))) : 0;

                return (
                  <>
                    <div className="flex items-start gap-4">
                      <div className="mt-0.5 h-12 w-12 rounded-2xl bg-linear-to-br from-[#F58131] to-[#FF9A52] text-white flex items-center justify-center ring-8 ring-[#F58131]/15">
                        <Loader2 className="h-6 w-6 animate-spin" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-base font-semibold tracking-tight">{title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{busyStep ?? "Starting…"}</p>
                      </div>
                    </div>

                    <div className="mt-4 h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-linear-to-r from-[#F58131] to-[#FF9A52] transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="mt-5 space-y-2">
                      {steps.map((s) => {
                        const stepIdx = steps.indexOf(s);
                        const isActive = s === busyStep;
                        const isDone = !isActive && (busyVisitedSteps.includes(s) || (activeIdx >= 0 && stepIdx >= 0 && stepIdx < activeIdx));
                        return (
                          <div key={s} className="flex items-center gap-2 text-sm">
                            <div
                              className={cn(
                                "h-5 w-5 rounded-full flex items-center justify-center border",
                                isDone
                                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700"
                                  : isActive
                                    ? "bg-[#F58131]/10 border-[#F58131]/30 text-[#F58131]"
                                    : "bg-muted border-border text-muted-foreground"
                              )}
                            >
                              {isDone ? <Check className="h-3.5 w-3.5" /> : isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                            </div>
                            <span className={cn(isActive ? "font-medium text-foreground" : isDone ? "text-foreground" : "text-muted-foreground")}>
                              {s}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <p className="mt-5 text-xs text-muted-foreground">
                      Please don’t close this tab while {busyAction === "delete_course" ? "deleting" : "saving"}.
                    </p>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      ) : null}

      {csvImportOpen ? (
        <div className="fixed inset-0 z-1000 bg-black/50 p-4 sm:p-6 overflow-y-auto">
          <div className="min-h-[calc(100svh-2rem)] sm:min-h-[calc(100svh-3rem)] flex items-center justify-center">
            <div className="w-full max-w-4xl rounded-lg border bg-card shadow-xl">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div>
                  <h3 className="font-semibold">Import Course Assignments CSV</h3>
                  <p className="text-sm text-muted-foreground">Upload a CSV template for this course, preview changes, then apply them.</p>
                </div>
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => setCsvImportOpen(false)} disabled={csvPreviewLoading || csvApplyLoading}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="p-4 space-y-4">
                <div className="rounded-md border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={csvPreviewLoading || csvApplyLoading}
                      onClick={() => csvImportInputRef.current?.click()}
                    >
                      <Upload className="h-4 w-4" />
                      {csvPreviewLoading ? "Validating..." : "Choose CSV File"}
                    </Button>
                    <Button type="button" variant="outline" disabled={csvPreviewLoading || csvApplyLoading} onClick={downloadAssignmentCsvTemplate}>
                      <FileSpreadsheet className="h-4 w-4" />
                      Download Fresh Template
                    </Button>
                    <span className="text-sm text-muted-foreground">{csvImportFileName ?? "No file selected"}</span>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Template includes instruction lines at the top. Required columns: <code>user_id</code>, <code>email</code>, <code>full_name</code>, <code>course_id</code>, <code>course_name</code>, <code>assigned</code>, <code>tfa</code>.
                    Allowed TFA values: <code>unlimited</code>, <code>3m</code>, <code>1m</code>, <code>1w</code>.
                  </p>
                  <input
                    ref={csvImportInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      void handleCsvImportSelected(file);
                      e.currentTarget.value = "";
                    }}
                  />
                </div>

                {csvImportPreview ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                      {[
                        ["Rows", String(csvImportPreview.summary.total_rows)],
                        ["Assign", String(csvImportPreview.summary.assign_count)],
                        ["Update", String(csvImportPreview.summary.update_count)],
                        ["Remove", String(csvImportPreview.summary.remove_count)],
                        ["Unchanged", String(csvImportPreview.summary.unchanged_count)],
                        ["Invalid", String(csvImportPreview.summary.invalid_rows)],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-md border bg-background p-3">
                          <div className="text-xs text-muted-foreground">{label}</div>
                          <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
                        </div>
                      ))}
                    </div>

                    {csvImportPreview.invalid_rows.length > 0 ? (
                      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
                        <div className="mb-2 text-sm font-medium text-destructive">Fix invalid rows before applying the import.</div>
                        <div className="max-h-48 overflow-auto space-y-2 text-sm">
                          {csvImportPreview.invalid_rows.map((row) => (
                            <div key={`${row.row_number}-${row.user_id}`} className="rounded border bg-background px-3 py-2">
                              <div className="font-medium">Row {row.row_number} • {row.full_name || row.email || row.user_id}</div>
                              <div className="text-muted-foreground">{row.error}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-md border">
                      <div className="border-b px-4 py-3">
                        <div className="font-medium">Preview</div>
                        <div className="text-sm text-muted-foreground">These are the changes that will be applied to the course members list.</div>
                      </div>
                      <div className="max-h-72 overflow-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-card">
                            <tr className="border-b text-left">
                              <th className="px-4 py-2">Row</th>
                              <th className="px-4 py-2">Member</th>
                              <th className="px-4 py-2">Email</th>
                              <th className="px-4 py-2">Assigned</th>
                              <th className="px-4 py-2">TFA</th>
                              <th className="px-4 py-2">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {csvImportPreview.valid_rows.map((row) => (
                              <tr key={`${row.row_number}-${row.user_id}`} className="border-b last:border-b-0">
                                <td className="px-4 py-2 text-muted-foreground">{row.row_number}</td>
                                <td className="px-4 py-2">{row.full_name || "—"}</td>
                                <td className="px-4 py-2">{row.email || "—"}</td>
                                <td className="px-4 py-2">{row.assigned ? "Yes" : "No"}</td>
                                <td className="px-4 py-2">{row.tfa ? accessKeyLabel(row.tfa) : "—"}</td>
                                <td className="px-4 py-2 capitalize">{row.action}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="flex items-center justify-between border-t px-4 py-3">
                <Button type="button" variant="outline" onClick={() => setCsvImportOpen(false)} disabled={csvPreviewLoading || csvApplyLoading}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={!csvImportPreview || csvImportPreview.invalid_rows.length > 0 || csvApplyLoading || csvPreviewLoading}
                  onClick={() => void applyCsvImport()}
                >
                  {csvApplyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Apply Import
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {successModal ? (
        <div className="fixed inset-0 z-1000 bg-black/40 backdrop-blur-sm p-4 sm:p-6 overflow-y-auto">
          <div className="min-h-[calc(100svh-2rem)] sm:min-h-[calc(100svh-3rem)] flex items-center justify-center">
            <div className="relative w-full max-w-sm rounded-2xl border bg-card shadow-2xl px-6 py-7 text-center">
              <button
                type="button"
                aria-label="Close"
                className="absolute right-3 top-3 rounded-full p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                onClick={() => setSuccessModal(null)}
              >
                <X className="h-4 w-4" />
              </button>

              <div className="mx-auto h-16 w-16 rounded-full bg-linear-to-br from-emerald-500 to-emerald-600 text-white flex items-center justify-center ring-8 ring-emerald-500/15">
                <Check className="h-8 w-8" />
              </div>

              <h3 className="mt-5 text-2xl font-semibold tracking-tight">Success!</h3>
              <p className="mt-2 text-base font-medium text-foreground">{successModal.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{successModal.description}</p>

              <div className="mt-6">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full rounded-full border-emerald-600 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                  onClick={() => setSuccessModal(null)}
                >
                  Continue
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

