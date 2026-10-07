"use client";
import {useUi} from "@/i18n/useUi";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { Bold, Highlighter, Image as ImageIcon, Info, Italic, Link as LinkIcon, List, ListOrdered, Palette, Underline as UnderlineIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Mark, Node as TiptapNode, mergeAttributes } from "@tiptap/core";

const COLOR_TOKENS = [
  "slate-900",
  "slate-700",
  "gray-900",
  "gray-700",
  "zinc-900",
  "neutral-900",
  "stone-900",
  "red-700",
  "red-500",
  "orange-700",
  "orange-500",
  "amber-700",
  "yellow-800",
  "lime-700",
  "green-700",
  "green-500",
  "emerald-700",
  "teal-700",
  "teal-500",
  "cyan-700",
  "sky-700",
  "blue-700",
  "blue-500",
  "indigo-700",
  "violet-700",
  "purple-700",
  "purple-500",
  "fuchsia-700",
  "pink-700",
  "rose-700",
] as const;
type ColorToken = (typeof COLOR_TOKENS)[number];

const TextColorMark = Mark.create({
  name: "rtTextColor",
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-rt-color"),
        renderHTML: (attrs) => {
          if (!attrs.color) return {};
          return { "data-rt-color": String(attrs.color) };
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-rt-color]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
  addCommands() {
    return {
      setRtTextColor:
        (color: ColorToken) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetRtTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

const TextBgMark = Mark.create({
  name: "rtTextBg",
  addAttributes() {
    return {
      bg: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-rt-bg"),
        renderHTML: (attrs) => {
          if (!attrs.bg) return {};
          return { "data-rt-bg": String(attrs.bg) };
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-rt-bg]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
  addCommands() {
    return {
      setRtTextBg:
        (bg: ColorToken) =>
        ({ commands }) =>
          commands.setMark(this.name, { bg }),
      unsetRtTextBg:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

const Callout = TiptapNode.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      variant: {
        default: "info",
        parseHTML: (element) => element.getAttribute("data-callout") || "info",
        renderHTML: (attrs) => ({ "data-callout": String(attrs.variant || "info") }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes), ["div", { "data-callout-body": "true" }, 0]];
  },
  addCommands() {
    return {
      toggleInfoCallout:
        () =>
        ({ commands }) =>
          // Toggle a wrapping node similar to blockquote behavior.
          commands.toggleWrap(this.name, { variant: "info" }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    rtTextColor: {
      setRtTextColor: (color: ColorToken) => ReturnType;
      unsetRtTextColor: () => ReturnType;
    };
    rtTextBg: {
      setRtTextBg: (bg: ColorToken) => ReturnType;
      unsetRtTextBg: () => ReturnType;
    };
    callout: {
      toggleInfoCallout: () => ReturnType;
    };
  }
}

const InlineImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      inlineUploadId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-inline-upload-id"),
        renderHTML: (attrs) => {
          if (!attrs.inlineUploadId) return {};
          return { "data-inline-upload-id": String(attrs.inlineUploadId) };
        },
      },
    };
  },
});

function makeUploadId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  minHeightClass = "min-h-[220px]",
  onInlineImageQueued,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder: string;
  className?: string;
  minHeightClass?: string;
  onInlineImageQueued?: (args: { uploadId: string; file: File; objectUrl: string }) => void;
}) {
  const ui = useUi();
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [textPaletteOpen, setTextPaletteOpen] = useState(false);
  const [bgPaletteOpen, setBgPaletteOpen] = useState(false);
  const textPaletteRef = useRef<HTMLDivElement | null>(null);
  const bgPaletteRef = useRef<HTMLDivElement | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      // Custom rich styling (data-attrs, no inline styles)
      TextColorMark,
      TextBgMark,
      // Custom callout block (info)
      Callout,
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      InlineImage.configure({
        allowBase64: true,
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm dark:prose-invert max-w-none focus:outline-none px-3 py-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1",
          minHeightClass
        ),
      },
      handleDrop: (view, event) => {
        if (!onInlineImageQueued) return false;
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();

        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
        for (const f of files) {
          const uploadId = makeUploadId();
          const objectUrl = URL.createObjectURL(f);
          onInlineImageQueued({ uploadId, file: f, objectUrl });
          if (typeof pos === "number") {
            // Insert at the drop position.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (editor as any)?.commands?.insertContentAt?.(pos, {
              type: "image",
              attrs: { src: objectUrl, alt: f.name, inlineUploadId: uploadId },
            });
          } else {
            // Fallback: insert at cursor.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (editor as any)?.chain?.().focus().setImage({ src: objectUrl, alt: f.name, inlineUploadId: uploadId }).run();
          }
        }
        return true;
      },
      handlePaste: (_view, event) => {
        if (!onInlineImageQueued) return false;
        const items = Array.from(event.clipboardData?.items ?? []);
        const files = items
          .map((it) => (it.kind === "file" ? it.getAsFile() : null))
          .filter((f): f is File => Boolean(f) && f!.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();

        for (const f of files) {
          const uploadId = makeUploadId();
          const objectUrl = URL.createObjectURL(f);
          onInlineImageQueued({ uploadId, file: f, objectUrl });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (editor as any)?.chain?.().focus().setImage({ src: objectUrl, alt: f.name, inlineUploadId: uploadId }).run();
        }
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
  });

  const blockTag = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed?.isInitialized) return "p";
      const levels = [1, 2, 3, 4, 5, 6] as const;
      for (const level of levels) {
        if (ed.isActive("heading", { level })) return `h${level}`;
      }
      return "p";
    },
  });

  const activeTextColor = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed?.isInitialized) return null;
      const raw = (ed.getAttributes("rtTextColor") as { color?: unknown } | null)?.color;
      return typeof raw === "string" ? raw : null;
    },
  });

  const activeBg = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed?.isInitialized) return null;
      const raw = (ed.getAttributes("rtTextBg") as { bg?: unknown } | null)?.bg;
      return typeof raw === "string" ? raw : null;
    },
  });

  const applyBlockTag = useCallback(
    (tag: string) => {
      if (!editor) return;
      if (tag === "p") {
        editor.chain().focus().setParagraph().run();
        return;
      }
      const level = Number(tag.replace(/^h/i, ""));
      if (Number.isFinite(level) && level >= 1 && level <= 6) {
        editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
      }
    },
    [editor]
  );

  const applyTextColor = useCallback(
    (token: ColorToken | null) => {
      if (!editor) return;
      if (!token) {
        editor.chain().focus().unsetRtTextColor().run();
      } else {
        editor.chain().focus().setRtTextColor(token).run();
      }
    },
    [editor]
  );

  const applyBg = useCallback(
    (token: ColorToken | null) => {
      if (!editor) return;
      if (!token) {
        editor.chain().focus().unsetRtTextBg().run();
      } else {
        editor.chain().focus().setRtTextBg(token).run();
      }
    },
    [editor]
  );

  const textSwatchToken = useMemo(() => (activeTextColor && COLOR_TOKENS.includes(activeTextColor as ColorToken) ? (activeTextColor as ColorToken) : null), [activeTextColor]);
  const bgSwatchToken = useMemo(() => (activeBg && COLOR_TOKENS.includes(activeBg as ColorToken) ? (activeBg as ColorToken) : null), [activeBg]);

  const insertImagesFromPicker = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      if (!onInlineImageQueued) return;
      if (!editor) return;
      for (const f of files) {
        if (!f.type.startsWith("image/")) continue;
        const uploadId = makeUploadId();
        const objectUrl = URL.createObjectURL(f);
        onInlineImageQueued({ uploadId, file: f, objectUrl });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (editor as any)?.chain?.().focus().setImage({ src: objectUrl, alt: f.name, inlineUploadId: uploadId }).run();
      }
    },
    [editor, onInlineImageQueued]
  );

  useEffect(() => {
    if (!textPaletteOpen && !bgPaletteOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (textPaletteOpen && textPaletteRef.current && textPaletteRef.current.contains(target)) return;
      if (bgPaletteOpen && bgPaletteRef.current && bgPaletteRef.current.contains(target)) return;
      setTextPaletteOpen(false);
      setBgPaletteOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown, true);
    return () => document.removeEventListener("mousedown", onDocMouseDown, true);
  }, [bgPaletteOpen, textPaletteOpen]);

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (current !== (value || "")) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [editor, value]);

  if (!editor) {
    return (
      <div className={cn("rounded-md border p-3 text-sm text-muted-foreground", className)}>
        {ui("Loading editor...")}</div>
    );
  }

  return (
    <div className={cn("rt-editor rounded-md border bg-background", className)}>
      <div className="flex items-center gap-1 border-b p-2 flex-wrap">
        <select
          value={blockTag ?? "p"}
          onChange={(e) => applyBlockTag(e.target.value)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
          aria-label={ui("Block type")}
        >
          <option value="p">{ui("Paragraph")}</option>
          <option value="h1">H1</option>
          <option value="h2">H2</option>
          <option value="h3">H3</option>
          <option value="h4">H4</option>
          <option value="h5">H5</option>
          <option value="h6">H6</option>
        </select>

        <div className="relative" ref={textPaletteRef}>
          <Button
            type="button"
            size="icon-sm"
            variant={textPaletteOpen ? "secondary" : "ghost"}
            onClick={() => {
              setBgPaletteOpen(false);
              setTextPaletteOpen((v) => !v);
            }}
            title={ui("Text color")}
            aria-label={ui("Text color")}
          >
            <Palette className="h-4 w-4" />
          </Button>
          <span
            className="ml-0.5 inline-flex h-3.5 w-3.5 rounded-sm border align-middle"
            data-rt-swatch="text"
            data-token={textSwatchToken ?? undefined}
            title={textSwatchToken ?? ui("No text color")}
          />
          {textPaletteOpen ? (
            <div className="absolute z-50 mt-2 w-[260px] rounded-md border bg-card p-2 shadow-lg">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-xs font-semibold text-muted-foreground">{ui("Text color")}</div>
                <Button type="button" size="sm" variant="ghost" onClick={() => { applyTextColor(null); setTextPaletteOpen(false); }}>
                  {ui("Clear")}</Button>
              </div>
              <div className="grid grid-cols-10 gap-1">
                {COLOR_TOKENS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={cn("h-6 w-6 rounded-sm border hover:scale-[1.03] transition-transform")}
                    data-rt-swatch="text"
                    data-token={t}
                    title={t}
                    onClick={() => {
                      applyTextColor(t);
                      setTextPaletteOpen(false);
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="relative" ref={bgPaletteRef}>
          <Button
            type="button"
            size="icon-sm"
            variant={bgPaletteOpen ? "secondary" : "ghost"}
            onClick={() => {
              setTextPaletteOpen(false);
              setBgPaletteOpen((v) => !v);
            }}
            title={ui("Highlight")}
            aria-label={ui("Highlight")}
          >
            <Highlighter className="h-4 w-4" />
          </Button>
          <span
            className="ml-0.5 inline-flex h-3.5 w-3.5 rounded-sm border align-middle"
            data-rt-swatch="bg"
            data-token={bgSwatchToken ?? undefined}
            title={bgSwatchToken ?? ui("No highlight")}
          />
          {bgPaletteOpen ? (
            <div className="absolute z-50 mt-2 w-[260px] rounded-md border bg-card p-2 shadow-lg">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-xs font-semibold text-muted-foreground">{ui("Highlight")}</div>
                <Button type="button" size="sm" variant="ghost" onClick={() => { applyBg(null); setBgPaletteOpen(false); }}>
                  {ui("Clear")}</Button>
              </div>
              <div className="grid grid-cols-10 gap-1">
                {COLOR_TOKENS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={cn("h-6 w-6 rounded-sm border hover:scale-[1.03] transition-transform")}
                    data-rt-swatch="bg"
                    data-token={t}
                    title={t}
                    onClick={() => {
                      applyBg(t);
                      setBgPaletteOpen(false);
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <Button
          type="button"
          size="icon-sm"
          variant={editor.isActive("callout") ? "secondary" : "ghost"}
          onClick={() => {
            editor.chain().focus().toggleInfoCallout().run();
          }}
          title={ui("Info callout")}
        >
          <Info className="h-4 w-4" />
        </Button>

        <Button
          type="button"
          size="icon-sm"
          variant={editor.isActive("bold") ? "secondary" : "ghost"}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant={editor.isActive("italic") ? "secondary" : "ghost"}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant={editor.isActive("underline") ? "secondary" : "ghost"}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant={editor.isActive("bulletList") ? "secondary" : "ghost"}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant={editor.isActive("orderedList") ? "secondary" : "ghost"}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant={editor.isActive("link") ? "secondary" : "ghost"}
          onClick={() => {
            const prev = editor.getAttributes("link").href as string | undefined;
            const url = window.prompt("Enter URL", prev || "https://");
            if (url === null) return;
            if (!url.trim()) {
              editor.chain().focus().unsetLink().run();
              return;
            }
            editor.chain().focus().setLink({ href: url.trim() }).run();
          }}
        >
          <LinkIcon className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => {
            if (onInlineImageQueued) {
              imageInputRef.current?.click();
              return;
            }
            const url = window.prompt("Enter image URL", "https://");
            if (url === null) return;
            if (!url.trim()) return;
            editor.chain().focus().setImage({ src: url.trim() }).run();
          }}
          title={ui("Insert image")}
        >
          <ImageIcon className="h-4 w-4" />
        </Button>
        {onInlineImageQueued ? (
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              // reset so picking the same file again triggers onChange
              e.target.value = "";
              insertImagesFromPicker(files);
            }}
          />
        ) : null}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

