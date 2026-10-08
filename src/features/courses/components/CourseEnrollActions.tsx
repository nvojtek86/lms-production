"use client";
import {useUi} from "@/i18n/useUi";


import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/api";

export function CourseEnrollActions({
  orgId,
  courseId,
  courseHrefKey,
  isEnrolled,
  disabled,
  className,
}: {
  orgId: string;
  // UUID used for API calls / DB
  courseId: string;
  // Slug (preferred) or UUID used in URLs
  courseHrefKey: string;
  isEnrolled: boolean;
  disabled: boolean;
  className?: string;
}) {
  const ui = useUi();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function enrollAndStart() {
    if (disabled) return;
    if (isEnrolled) {
      router.push(`/org/${orgId}/courses/${courseHrefKey}/learn`);
      return;
    }

    setLoading(true);
    try {
      const { message } = await fetchJson<{ enrollment: unknown }>(`/api/courses/${courseId}/enroll`, { method: "POST" });
      toast.success(ui(message || "Enrollment started."));
      router.push(`/org/${orgId}/courses/${courseHrefKey}/learn`);
    } catch (e) {
      toast.error(ui(e instanceof Error ? e.message : "Failed to enroll"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button onClick={() => void enrollAndStart()} disabled={disabled || loading} className={["gap-2", className].filter(Boolean).join(" ")}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      {isEnrolled ? ui("Continue learning") : ui("Start learning")}
    </Button>
  );
}

