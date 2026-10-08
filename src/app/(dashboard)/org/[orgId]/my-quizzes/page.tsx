
import {getUi} from "@/i18n/server";
import { notFound, redirect } from "next/navigation";
import { FileText, CheckCircle, XCircle, ClipboardList } from "lucide-react";

import { createServerSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { resolveOrgKey } from "@/lib/organizations/resolveOrgKey";
import { MyQuizzesClient, type MyQuizAttemptRow } from "@/features/quizzes/components/MyQuizzesClient";

export const fetchCache = "force-no-store";

type CourseRow = { id: string; title: string | null; slug?: string | null };
type ItemRow = { id: string; title: string | null; course_id: string | null };

export default async function StudentMyQuizzesPage({ params }: { params: Promise<{ orgId: string }> }) {
  const ui = await getUi();
  const { user, error } = await getServerUser();
  if (error || !user) redirect("/");

  const { orgId: orgKey } = await params;
  const resolved = await resolveOrgKey(orgKey);
  const org = resolved.org;
  if (!org) {
    if (user.role === "organization_admin" || user.role === "member") redirect("/unauthorized");
    notFound();
  }

  const orgId = org.id; // UUID
  const orgSlug = org.slug; // canonical slug

  if (user.role !== "member") redirect(`/org/${orgSlug}`);
  if (!user.organization_id || user.organization_id !== orgId) redirect("/unauthorized");

  const supabase = await createServerSupabaseClient();

  const { data: enrollments } = await supabase
    .from("course_enrollments")
    .select("course_id")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .eq("status", "active");

  const courseIds = (Array.isArray(enrollments) ? enrollments : [])
    .map((r: { course_id?: string | null }) => r.course_id)
    .filter((v): v is string => typeof v === "string");

  // Pull results across all enrolled courses.
  const { data: resultsData } = courseIds.length
    ? await supabase
        .from("course_v2_quiz_attempt_results")
        .select("attempt_id, course_id, item_id, graded_at, score_percent, passed, earned_points, total_points")
        .eq("organization_id", orgId)
        .eq("user_id", user.id)
        .in("course_id", courseIds)
        .order("graded_at", { ascending: false })
        .limit(500)
    : { data: [] };

  const results = (Array.isArray(resultsData) ? resultsData : []) as Array<{
    attempt_id: string;
    course_id: string;
    item_id: string;
    graded_at: string;
    score_percent: number;
    passed: boolean;
    earned_points: number;
    total_points: number;
  }>;

  const attemptIds = results.map((r) => r.attempt_id);
  const itemIds = Array.from(new Set(results.map((r) => r.item_id)));
  const courseIdsInResults = Array.from(new Set(results.map((r) => r.course_id)));

  const [{ data: attemptsData }, { data: coursesData }, { data: itemsData }] = await Promise.all([
    attemptIds.length
      ? supabase.from("course_v2_quiz_attempts").select("id, attempt_number, submitted_at").in("id", attemptIds)
      : Promise.resolve({ data: [] } as { data: unknown[] }),
    courseIdsInResults.length
      ? supabase.from("courses").select("id, title, slug").in("id", courseIdsInResults)
      : Promise.resolve({ data: [] } as { data: unknown[] }),
    itemIds.length
      ? supabase.from("course_topic_items").select("id, title, course_id").in("id", itemIds)
      : Promise.resolve({ data: [] } as { data: unknown[] }),
  ]);

  const attemptMap = new Map<string, { attempt_number: number | null; submitted_at: string | null }>();
  (Array.isArray(attemptsData) ? attemptsData : []).forEach((a) => {
    const id = String((a as { id?: unknown }).id ?? "");
    if (!id) return;
    const attempt_number = Number.isFinite(Number((a as { attempt_number?: unknown }).attempt_number))
      ? Number((a as { attempt_number: number }).attempt_number)
      : null;
    const submitted_at = typeof (a as { submitted_at?: unknown }).submitted_at === "string" ? String((a as { submitted_at: string }).submitted_at) : null;
    attemptMap.set(id, { attempt_number, submitted_at });
  });

  const courseMap = new Map<string, CourseRow>();
  (Array.isArray(coursesData) ? (coursesData as CourseRow[]) : []).forEach((c) => {
    if (!c?.id) return;
    courseMap.set(c.id, c);
  });

  const itemMap = new Map<string, ItemRow>();
  (Array.isArray(itemsData) ? (itemsData as ItemRow[]) : []).forEach((it) => {
    if (!it?.id) return;
    itemMap.set(it.id, it);
  });

  const rows: MyQuizAttemptRow[] = results.map((r) => {
    const attempt = attemptMap.get(r.attempt_id) ?? { attempt_number: null, submitted_at: null };
    const course = courseMap.get(r.course_id) ?? { id: r.course_id, title: null, slug: null };
    const item = itemMap.get(r.item_id) ?? { id: r.item_id, title: null, course_id: r.course_id };

    return {
      id: r.attempt_id,
      course_id: r.course_id,
      course_title: (course.title ?? "").trim() || "(untitled course)",
      course_slug: (course.slug ?? "").trim() || null,
      quiz_item_id: r.item_id,
      quiz_title: (item.title ?? "").trim() || "(untitled quiz)",
      attempt_number: attempt.attempt_number,
      graded_at: r.graded_at,
      score_percent: r.score_percent,
      passed: Boolean(r.passed),
      earned_points: r.earned_points ?? 0,
      total_points: r.total_points ?? 0,
    };
  });

  const totalAttempts = rows.length;
  const passedCount = rows.filter((x) => x.passed).length;
  const failedCount = rows.filter((x) => !x.passed).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileText className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">{ui("My Quizzes")}</h1>
          <p className="text-muted-foreground">{ui("Your full quiz attempt history across courses")}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border rounded-lg p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <ClipboardList className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{ui("Total attempts")}</p>
              <p className="text-2xl font-bold text-foreground">{totalAttempts}</p>
            </div>
          </div>
        </div>
        <div className="bg-card border rounded-lg p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-lg bg-green-100 flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{ui("Passed")}</p>
              <p className="text-2xl font-bold text-foreground">{passedCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-card border rounded-lg p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-lg bg-red-100 flex items-center justify-center">
              <XCircle className="h-6 w-6 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{ui("Failed")}</p>
              <p className="text-2xl font-bold text-foreground">{failedCount}</p>
            </div>
          </div>
        </div>
      </div>

      <MyQuizzesClient orgId={orgSlug} rows={rows} />
    </div>
  );
}

