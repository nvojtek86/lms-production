import { Award, Download } from "lucide-react";
import { createAdminSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

type OrganizationRow = { id: string; name?: string | null; slug?: string | null };
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

export default async function SystemCertificatesPage() {
  const { user, error } = await getServerUser();
  if (error || !user) return null;
  if (!["super_admin", "system_admin"].includes(user.role)) return null;

  const admin = createAdminSupabaseClient();

  const { data: certData, error: certError } = await admin
    .from("certificates")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  const certificates = (Array.isArray(certData) ? certData : []) as CertificateRow[];

  const [{ data: orgs }, { data: courses }, { data: users }] = await Promise.all([
    admin.from("organizations").select("id, name, slug"),
    admin.from("courses").select("id, title"),
    admin.from("users").select("id, email, full_name"),
  ]);

  const orgMap = new Map<string, OrganizationRow>();
  (Array.isArray(orgs) ? (orgs as OrganizationRow[]) : []).forEach((o) => orgMap.set(o.id, o));

  const courseMap = new Map<string, CourseRow>();
  (Array.isArray(courses) ? (courses as CourseRow[]) : []).forEach((c) => courseMap.set(c.id, c));

  const userMap = new Map<string, UserRow>();
  (Array.isArray(users) ? (users as UserRow[]) : []).forEach((u) => userMap.set(u.id, u));

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Award className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Certificates</h1>
            <p className="text-muted-foreground">Manage all certificates across organizations</p>
          </div>
        </div>
      </div>

      {certError ? (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Failed to load certificates: {certError.message}
        </div>
      ) : null}

      {/* Certificates Table */}
      <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="min-w-max w-full">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">User</th>
              <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">Course</th>
              <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">Organization</th>
              <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">Issued</th>
              <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">Expires</th>
              <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">Status</th>
              <th className="text-right px-6 py-3 text-sm font-medium text-muted-foreground">Download</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {certificates.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-muted-foreground">
                  No certificates found.
                </td>
              </tr>
            ) : (
              certificates.map((cert) => {
                const u = cert.user_id ? userMap.get(cert.user_id) : null;
                const c = cert.course_id ? courseMap.get(cert.course_id) : null;
                const o = cert.organization_id ? orgMap.get(cert.organization_id) : null;
                const issued = cert.issued_at ?? cert.created_at;
                const expires = cert.expires_at;
                const status = cert.status ?? "—";
                const courseLabel = (c?.title ?? "").trim() || (cert.course_title_snapshot ?? "").trim() || "Untitled course";
                const fullName = (u?.full_name ?? "").trim() || (cert.user_full_name_snapshot ?? "").trim();
                const email = (u?.email ?? "").trim() || (cert.user_email_snapshot ?? "").trim();
                const userLabel = fullName ? (email ? `${fullName} (${email})` : fullName) : (email || cert.user_id || "—");
                const canDownload = typeof cert.id === "string" && cert.id.length > 0;

                return (
                  <tr key={cert.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4 font-medium">{userLabel}</td>
                    <td className="px-6 py-4">{courseLabel}</td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {o?.name ?? o?.slug ?? cert.organization_name_snapshot ?? cert.organization_slug_snapshot ?? cert.organization_id ?? "—"}
                    </td>
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

