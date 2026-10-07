
import { DashboardSidebar } from "./DashboardSidebar";
import { DashboardHeader } from "./DashboardHeader";
import { DashboardFooter } from "./DashboardFooter";

export function DashboardLayout({ 
  children,
  centered = false 
}: { 
  children: React.ReactNode;
  centered?: boolean;
}) {
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <DashboardSidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <DashboardHeader />

        <main className={`flex-1 overflow-auto overscroll-contain ${centered ? "flex items-center justify-center" : 'p-6'}`}>
          {children}
        </main>

        <DashboardFooter />
      </div>
    </div>
  );
}