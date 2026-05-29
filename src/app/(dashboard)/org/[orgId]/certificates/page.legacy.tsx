import { Award, Download } from "lucide-react";
import { notFound } from "next/navigation";
import { createAdminSupabaseClient, createServerSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { resolveOrgKey } from "@/lib/organizations/resolveOrgKey";

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

  const [{ data: orgRow }] = await Promise.all([
    supabase.from("organizations").select("id, name, slug").eq("id", orgId).single(),
  ]);

  // Load certificates (role-dependent filter)
  let certQuery = supabase
    .from("certificates")
    .select("id, user_id, course_id, organization_id, issued_at, created_at, status, expires_at, course_title_snapshot, user_full_name_snapshot, user_email_snapshot")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (user.role === "member") {
    certQuery = certQuery.eq("user_id", user.id);
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

  const [{ data: coursesData }, { data: usersData }] = await Promise.all([
    courseIds.length > 0 ? admin.from("courses").select("id, title").in("id", courseIds) : Promise.resolve({ data: [] }),
    userIds.length > 0 ? admin.from("users").select("id, email, full_name").in("id", userIds) : Promise.resolve({ data: [] }),
  ]);

  const courseMap = new Map<string, CourseRow>();
  (Array.isArray(coursesData) ? (coursesData as CourseRow[]) : []).forEach((c) => courseMap.set(c.id, c));

  const userMap = new Map<string, UserRow>();
  (Array.isArray(usersData) ? (usersData as UserRow[]) : []).forEach((u) => userMap.set(u.id, u));

  const orgName = (orgRow as OrgRow | null)?.name ?? null;
  const orgSlug = (orgRow as OrgRow | null)?.slug ?? null;
  const orgLabel = (orgName && orgName.trim().length > 0) ? orgName : (orgSlug && orgSlug.trim().length > 0 ? orgSlug : orgSlugResolved || orgId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Award className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Certificates</h1>
            <p className="text-muted-foreground">Organization: {orgLabel}</p>
          </div>
        </div>
      </div>

      {certError ? (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Failed to load certificates: {certError.message}
        </div>
      ) : null}

      <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="min-w-max w-full">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">User</th>
              <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">Course</th>
              <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">Issued</th>
              <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">Expires</th>
              <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">Status</th>
              <th className="text-right px-6 py-3 text-sm font-medium text-muted-foreground">Download</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {certificates.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                  No certificates found.
                </td>
              </tr>
            ) : (
              certificates.map((cert) => {
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

                return (
                  <tr key={cert.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4 font-medium">
                      {userLabel}
                    </td>
                    <td className="px-6 py-4">{courseLabel}</td>
                    <td className="px-6 py-4">{issued ? new Date(issued).toLocaleDateString() : "—"}</td>
                    <td className="px-6 py-4 text-muted-foreground text-sm">{expires ? new Date(expires).toLocaleDateString() : "—"}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        String(status).toLowerCase() === "valid" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                      }`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {canDownload ? (
                        <Button size="sm" variant="outline" asChild>
                          <a
                            href={`/api/certificates/${cert.id}/download`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Download className="h-4 w-4" />
                            Download
                          </a>
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

