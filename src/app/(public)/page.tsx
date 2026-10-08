
import {useUi} from "@/i18n/useUi";
import { Suspense } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { LoginForm } from "@/components/auth/LoginForm";

function LoginFormFallback() {
  const ui = useUi();
  return (
    <div className="w-full max-w-md space-y-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-primary">{ui("Login")}</h1>
      </div>
      <div className="animate-pulse space-y-6">
        <div className="h-10 bg-muted rounded"></div>
        <div className="h-10 bg-muted rounded"></div>
        <div className="h-11 bg-muted rounded"></div>
      </div>
    </div>
  );
}

export default function PublicPage() {
  return (
    <DashboardLayout centered>
      <Suspense fallback={<LoginFormFallback />}>
        <LoginForm />
      </Suspense>
    </DashboardLayout>
  );
}
