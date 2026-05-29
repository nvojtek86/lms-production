import { notFound } from "next/navigation";
import { createAdminSupabaseClient, createServerSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { getUserOrganizationMemberships } from "@/lib/organizations/memberships";
import { resolveOrgKey } from "@/lib/organizations/resolveOrgKey";
import { CertificatesTableV2, type CertificateRowV2 } from "@/features/certificates";

type OrgRow = { id: string; name?: string | null; slug?: string | null };
type CourseRow = { id: string; title?: string | null };
type UserRow = { id: string; email?: string | null; full_name?: string | null };
type CertificateRow = {
  id: string;
  user_id?: string | null;
  course_id?: string | null;
  organization_id?: string | null;
  issued_at?: string | null;
  created_at?: string | null;
  status?: string | null;
  expires_at?: string | null;
  course_title_snapshot?: string | null;
  organization_name_snapshot?: string | null;
  organization_slug_snapshot?: string | null;
  user_full_name_snapshot?: string | null;
  user_email_snapshot?: string | null;
};

export default async function CertificatesPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { user, error } = await getServerUser();
  if (error || !user) return null;

  const { orgId: orgKey } = await params;
  const resolved = await resolveOrgKey(orgKey);
  const org = resolved.org;
  if (!org) {
    if (user.role === "organization_admin" || user.role === "member") return null;
    notFound();
  }

  const orgId = org.id; // UUID (DB/API)
  const orgSlugResolved = org.slug; // canonical slug (links)

  // Members should use /my-courses etc, but certificates route is "My Certificates" in nav.
  // Keep this page usable for members by filtering to their own certificates.
  const supabase = await createServerSupabaseClient();
  const membershipResult =
    user.role === "member"
      ? await getUserOrganizationMemberships(user.id, { roles: ["member"], activeOnly: true })
      : null;
  const membershipOrgIds = membershipResult?.memberships.map((membership) => membership.organizationId) ?? [];

  const [{ data: orgRow }] = await Promise.all([
    supabase.from("organizations").select("id, name, slug").eq("id", orgId).single(),
  ]);

  // Load certificates (role-dependent filter)
  let certQuery = supabase
    .from("certificates")
    .select("id, user_id, course_id, organization_id, issued_at, created_at, status, expires_at, course_title_snapshot, organization_name_snapshot, organization_slug_snapshot, user_full_name_snapshot, user_email_snapshot")
    .order("created_at", { ascending: false })
    .limit(200);

  if (user.role === "member") {
    certQuery = certQuery
      .eq("user_id", user.id)
      .in("organization_id", membershipOrgIds.length > 0 ? membershipOrgIds : ["00000000-0000-0000-0000-000000000000"]);
  } else {
    certQuery = certQuery.eq("organization_id", orgId);
  }

  const { data: certData, error: certError } = await certQuery;
  const certificates = (Array.isArray(certData) ? certData : []) as CertificateRow[];

  // Hydrate labels using admin client (safe: only for already-visible certificate rows).
  const admin = createAdminSupabaseClient();
  const courseIds = Array.from(
    new Set(
      certificates
        .map((c) => c.course_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0)
    )
  );
  const userIds = Array.from(
    new Set(
      certificates
        .map((c) => c.user_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0)
    )
  );

  const orgIds = Array.from(
    new Set(
      certificates
        .map((c) => c.organization_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0)
    )
  );

  const [{ data: coursesData }, { data: usersData }, { data: orgsData }] = await Promise.all([
    courseIds.length > 0 ? admin.from("courses").select("id, title").in("id", courseIds) : Promise.resolve({ data: [] }),
    userIds.length > 0 ? admin.from("users").select("id, email, full_name").in("id", userIds) : Promise.resolve({ data: [] }),
    orgIds.length > 0 ? admin.from("organizations").select("id, name, slug").in("id", orgIds) : Promise.resolve({ data: [] }),
  ]);

  const courseMap = new Map<string, CourseRow>();
  (Array.isArray(coursesData) ? (coursesData as CourseRow[]) : []).forEach((c) => courseMap.set(c.id, c));

  const userMap = new Map<string, UserRow>();
  (Array.isArray(usersData) ? (usersData as UserRow[]) : []).forEach((u) => userMap.set(u.id, u));

  const orgMap = new Map<string, OrgRow>();
  (Array.isArray(orgsData) ? (orgsData as OrgRow[]) : []).forEach((row) => orgMap.set(row.id, row));

  const orgName = (orgRow as OrgRow | null)?.name ?? null;
  const orgSlug = (orgRow as OrgRow | null)?.slug ?? null;
  const orgLabel = (orgName && orgName.trim().length > 0) ? orgName : (orgSlug && orgSlug.trim().length > 0 ? orgSlug : orgSlugResolved || orgId);

  const rows: CertificateRowV2[] = certificates.map((cert) => {
    const u = cert.user_id ? userMap.get(cert.user_id) : null;
    const c = cert.course_id ? courseMap.get(cert.course_id) : null;

    const issued = cert.issued_at ?? cert.created_at;
    const expires = cert.expires_at;
    const status = cert.status ?? "—";

    const courseLabel = (c?.title ?? "").trim() || (cert.course_title_snapshot ?? "").trim() || "Untitled course";

    const fullName =
      (u?.full_name && u.full_name.trim().length > 0 ? u.full_name.trim() : null) ??
      (cert.user_full_name_snapshot && cert.user_full_name_snapshot.trim().length > 0 ? cert.user_full_name_snapshot.trim() : null) ??
      (user.role === "member" && user.full_name && user.full_name.trim().length > 0 ? user.full_name.trim() : null);
    const email =
      (u?.email && u.email.trim().length > 0 ? u.email.trim() : null) ??
      (cert.user_email_snapshot && cert.user_email_snapshot.trim().length > 0 ? cert.user_email_snapshot.trim() : null) ??
      (user.role === "member" && user.email && user.email.trim().length > 0 ? user.email.trim() : null);
    const userLabel = fullName ? (email ? `${fullName} (${email})` : fullName) : (email ?? cert.user_id ?? "—");

    const canDownload = typeof cert.id === "string" && cert.id.length > 0;
    const downloadHref = canDownload ? `/api/certificates/${cert.id}/download` : null;

    const certificateOrg =
      cert.organization_id && orgMap.has(cert.organization_id) ? orgMap.get(cert.organization_id) ?? null : null;
    const certificateOrgLabel =
      certificateOrg?.name?.trim() ||
      certificateOrg?.slug?.trim() ||
      cert.organization_name_snapshot?.trim() ||
      cert.organization_slug_snapshot?.trim() ||
      orgLabel;

    return {
      id: cert.id,
      userLabel,
      courseLabel,
      issuedLabel: issued ? new Date(issued).toLocaleDateString() : "—",
      statusLabel: status,
      expiresLabel: expires ? new Date(expires).toLocaleDateString() : null,
      organizationLabel: certificateOrgLabel,
      canDownload,
      downloadHref,
      meta: cert,
    };
  });

  return (
    <div className="space-y-6">
      {certError ? (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Failed to load certificates: {certError.message}
        </div>
      ) : null}

      <CertificatesTableV2
        title="Certificates"
        subtitle={user.role === "member" ? "All active organizations" : `Organization: ${orgLabel}`}
        rows={rows}
      />
    </div>
  );
}

