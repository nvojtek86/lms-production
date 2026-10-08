
import {getUi} from "@/i18n/server";
import { notFound, redirect } from "next/navigation";
import { createAdminSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { resolveOrgKey } from "@/lib/organizations/resolveOrgKey";
import { UserTableV2 } from "@/features/users";

export default async function UsersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const ui = await getUi();
  const { user, error } = await getServerUser();
  if (error || !user) return null;

  const { orgId: orgKey } = await params;
  const resolved = await resolveOrgKey(orgKey);
  const org = resolved.org;
  if (!org) {
    if (user.role === "organization_admin" || user.role === "member") redirect("/unauthorized");
    notFound();
  }

  const orgId = org.id; // UUID (DB/API)
  const orgSlug = org.slug; // canonical slug (links)

  // Members should not access the admin users list
  if (user.role === "member") {
    redirect(`/org/${orgSlug}`);
  }

  const admin = createAdminSupabaseClient();
  const { data: orgRow } = await admin
    .from("organizations")
    .select("id, name, slug")
    .eq("id", orgId)
    .single();

  const orgName = (orgRow as { name?: unknown } | null)?.name;
  const orgSlugFromRow = (orgRow as { slug?: unknown } | null)?.slug;
  const organizationLabel =
    typeof orgName === "string" && orgName.trim().length > 0
      ? orgName.trim()
      : typeof orgSlugFromRow === "string" && orgSlugFromRow.trim().length > 0
        ? orgSlugFromRow.trim()
        : orgSlug || orgId;

  return (
    <div className="container mx-auto p-6">
      <UserTableV2 title={ui("All Users")} organizationId={orgId} organizationLabel={organizationLabel} />
    </div>
  );
}
