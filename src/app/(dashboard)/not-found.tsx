
import {getUi} from "@/i18n/server";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getServerUser } from "@/lib/supabase/server";

function getDashboardHref(user: Awaited<ReturnType<typeof getServerUser>>["user"]): string {
  if (!user) return "/";
  if (user.role === "super_admin") return "/admin";
  if (user.role === "system_admin") return "/system";
  if (user.role === "organization_admin" || user.role === "member") {
    return user.organization_id ? `/org/${user.organization_id}` : "/";
  }
  return "/";
}

export default async function DashboardNotFound() {
  const ui = await getUi();
  const { user } = await getServerUser();
  const dashboardHref = getDashboardHref(user);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center space-y-6 p-8">
        <div className="flex justify-center">
          <SearchX className="h-20 w-20 text-muted-foreground" />
        </div>

        <h1 className="text-3xl font-bold text-foreground">{ui("Page not found")}</h1>

        <p className="text-muted-foreground max-w-md">
          {ui("This route doesn’t exist. Use the button below to return to your dashboard.")}</p>

        <div className="flex gap-3 justify-center">
          <Button asChild>
            <Link href={dashboardHref}>{ui("Back to Dashboard")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

