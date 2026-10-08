import {getCourseLanguage} from "@/i18n/course";
import { notFound, redirect } from "next/navigation";
import { createServerSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { resolveOrgKey } from "@/lib/organizations/resolveOrgKey";
import { CourseEditorV2Form } from "@/features/courses/components/CourseEditorV2Form";
import type { CourseTopic, CourseV2, MemberOption } from "@/features/courses/components/CourseEditorV2Form";
import { loadActiveOrganizationMembers } from "@/lib/courseAssignments/syncAssignments";

export const fetchCache = "force-no-store";

type TopicRow = {
  id: string;
  title: string;
  summary: string | null;
  position: number;
};

type ItemRow = {
  id: string;
  topic_id: string;
  item_type: "lesson" | "quiz";
  title: string | null;
  position: number;
  payload_json: Record<string, unknown>;
  is_required?: boolean | null;
};

export default async function OrgCourseEditV2Page({
  params,
}: {
  params: Promise<{ orgId: string; courseId: string }>;
}) {
  const { user, error } = await getServerUser();
  if (error || !user) redirect("/");

  const { orgId: orgKey, courseId } = await params;
  const resolved = await resolveOrgKey(orgKey);
  const org = resolved.org;
  if (!org) {
    if (user.role === "organization_admin" || user.role === "member") redirect("/unauthorized");
    notFound();
  }

  const orgId = org.id;
  const orgSlug = org.slug;
  if (user.role !== "organization_admin") redirect("/unauthorized");
  if (!user.organization_id || user.organization_id !== orgId) redirect("/unauthorized");

  const supabase = await createServerSupabaseClient();
  const membersResultPromise = loadActiveOrganizationMembers(orgId);

  const [
    { data: courseRow, error: courseError },
    { data: topicsData },
    { data: itemsData },
    { data: assignedData },
    membersResult,
  ] = await Promise.all([
      supabase
        .from("courses")
        .select(
          "id, organization_id, title, slug, status, about_html, excerpt, difficulty_level, what_will_learn, total_duration_hours, total_duration_minutes, materials_included, requirements_instructions, intro_video_provider, intro_video_url, intro_video_storage_path, cover_image_url"
        )
        .eq("id", courseId)
        .single(),
      supabase.from("course_topics").select("id, title, summary, position").eq("course_id", courseId).order("position", { ascending: true }),
      supabase
        .from("course_topic_items")
        .select("id, topic_id, item_type, title, position, payload_json, is_required")
        .eq("course_id", courseId)
        .order("position", { ascending: true }),
      supabase
        .from("course_member_assignments")
        .select("user_id, access_duration_key, access_expires_at, assigned_at")
        .eq("course_id", courseId)
        .eq("organization_id", orgId),
      membersResultPromise,
    ]);

  if (courseError || !courseRow) redirect(`/org/${orgSlug}/courses`);
  if ((courseRow.organization_id ?? null) !== orgId) redirect("/unauthorized");
  if (membersResult.error) {
    throw new Error(`Failed to load members: ${membersResult.error}`);
  }

  const memberOptions: MemberOption[] = membersResult.members.map((m) => ({
    id: m.userId,
    label: m.fullName ?? m.email ?? m.userId,
  }));

  const itemMap = new Map<string, ItemRow[]>();
  for (const item of (Array.isArray(itemsData) ? itemsData : []) as ItemRow[]) {
    const arr = itemMap.get(item.topic_id) ?? [];
    arr.push(item);
    itemMap.set(item.topic_id, arr);
  }

  const topics: CourseTopic[] = ((Array.isArray(topicsData) ? topicsData : []) as TopicRow[]).map((t) => ({
    id: t.id,
    title: t.title,
    summary: t.summary,
    position: t.position,
    items: (itemMap.get(t.id) ?? [])
      .sort((a, b) => a.position - b.position)
      .map((it) => ({
        id: it.id,
        item_type: it.item_type,
        title: it.title ?? null,
        position: it.position,
        payload_json: it.payload_json ?? {},
        is_required: Boolean(it.is_required),
      })),
  }));

  const assignedRows = Array.isArray(assignedData) ? assignedData : [];
  const assignedMemberIds = assignedRows.map((r) => r.user_id).filter((v): v is string => typeof v === "string");
  const assignedMemberAccess: Record<string, "unlimited" | "3m" | "1m" | "1w"> = {};
  const assignedMemberExpiresAt: Record<string, string | null> = {};
  for (const r of assignedRows as Array<{ user_id?: unknown; access_duration_key?: unknown; access_expires_at?: unknown }>) {
    const uid = typeof r.user_id === "string" ? r.user_id : null;
    if (!uid) continue;
    const key = typeof r.access_duration_key === "string" ? r.access_duration_key : null;
    assignedMemberAccess[uid] = key === "3m" || key === "1m" || key === "1w" ? key : "unlimited";
    assignedMemberExpiresAt[uid] = typeof r.access_expires_at === "string" ? r.access_expires_at : null;
  }

  const courseLanguage = await getCourseLanguage(courseId);
  const initialCourse: CourseV2 = {
    default_language: courseLanguage.locale,
    language_settings_available: courseLanguage.available,
    id: String(courseRow.id),
    title: (courseRow as { title?: string | null }).title ?? null,
    slug: (courseRow as { slug?: string | null }).slug ?? null,
    status: ((courseRow as { status?: "draft" | "published" | null }).status ?? "draft") as "draft" | "published",
    about_html: (courseRow as { about_html?: string | null }).about_html ?? null,
    excerpt: (courseRow as { excerpt?: string | null }).excerpt ?? null,
    difficulty_level:
      ((courseRow as { difficulty_level?: CourseV2["difficulty_level"] }).difficulty_level ?? "all_levels") as CourseV2["difficulty_level"],
    what_will_learn: (courseRow as { what_will_learn?: string | null }).what_will_learn ?? null,
    total_duration_hours: (courseRow as { total_duration_hours?: number | null }).total_duration_hours ?? 0,
    total_duration_minutes: (courseRow as { total_duration_minutes?: number | null }).total_duration_minutes ?? 0,
    materials_included: (courseRow as { materials_included?: string | null }).materials_included ?? null,
    requirements_instructions: (courseRow as { requirements_instructions?: string | null }).requirements_instructions ?? null,
    intro_video_provider: (courseRow as { intro_video_provider?: CourseV2["intro_video_provider"] }).intro_video_provider ?? null,
    intro_video_url: (courseRow as { intro_video_url?: string | null }).intro_video_url ?? null,
    intro_video_storage_path: (courseRow as { intro_video_storage_path?: string | null }).intro_video_storage_path ?? null,
    cover_image_url: (courseRow as { cover_image_url?: string | null }).cover_image_url ?? null,
    assigned_member_ids: assignedMemberIds,
    assigned_member_access: assignedMemberAccess,
    assigned_member_expires_at: assignedMemberExpiresAt,
  };

  return (
    <CourseEditorV2Form
      mode="edit"
      orgSlug={orgSlug}
      backHref={`/org/${orgSlug}/courses`}
      initialCourse={initialCourse}
      initialTopics={topics}
      memberOptions={memberOptions}
    />
  );
}

