"use client";
import {useUi} from "@/i18n/useUi";


import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const ui = useUi();
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsLoading(true);

    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

      // Security best practice: don't leak whether the email exists.
      if (error) {
        console.error("resetPasswordForEmail error:", error);
      }

      setSuccess(ui("If an account exists for this email, you'll receive a password reset link shortly."));
      setEmail("");
    } catch (e) {
      setError(ui(e instanceof Error ? e.message : "Failed to send reset email"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Simple header */}
      <header className="border-b py-4 px-6">
        <Link 
          href="/" 
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={16} />
          {ui("Back to Login")}</Link>
      </header>

      {/* Form content */}
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold text-foreground">{ui("Forgot password")}</h1>
            <p className="text-muted-foreground">
              {ui("Enter your email and we'll send a reset link.")}</p>
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {ui(error)}
            </div>
          )}
          {success && (
            <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {success}
            </div>
          )}

          <div className="rounded-lg border bg-card p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{ui("Email")}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                />
              </div>

              <Button className="w-full" type="submit" disabled={isLoading}>
                {isLoading ? ui("Sending...") : ui("Send reset link")}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm text-muted-foreground">
              <Link href="/" className="text-primary hover:underline">
                {ui("Back to login")}</Link>
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            {ui("Invite-only: if you don't have an account yet, contact your organization admin for an invitation.")}</p>
        </div>
      </main>
    </div>
  );
}
