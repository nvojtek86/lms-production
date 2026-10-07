
import {getUi} from "@/i18n/server";
import Link from "next/link";
import { Facebook, Twitter, Linkedin } from "lucide-react";
import { getServerUser } from "@/lib/supabase/server";

export async function DashboardFooter() {
  const ui = await getUi();
  const { user } = await getServerUser();
  if (!user) return null;

  return (
    <footer className="border-t py-4 px-6 bg-background">
      <div className="flex items-center justify-between">
        <div className="flex gap-6 text-sm text-muted-foreground">
          <Link href="https://www.smartconsulting-agency.com/" target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors">
            {ui("Company")}</Link>
          <Link href="/support" className="hover:text-foreground transition-colors">
            {ui("Support")}</Link>
          <Link href="/legal" className="hover:text-foreground transition-colors">
            {ui("Legal")}</Link>
        </div>

        <div className="flex gap-4">
          <Link href="#" className="text-muted-foreground hover:text-secondary transition-colors">
            <Facebook size={18} />
          </Link>
          <Link href="#" className="text-muted-foreground hover:text-secondary transition-colors">
            <Twitter size={18} />
          </Link>
          <Link href="#" className="text-muted-foreground hover:text-secondary transition-colors">
            <Linkedin size={18} />
          </Link>
        </div>
      </div>
    </footer>
  );
}