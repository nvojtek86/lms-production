"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleAlert } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AuthLinkFlow = "invite" | "recovery" | "email" | "unknown";
type AuthLinkStage = "redirect" | "verify_otp" | "code_exchange" | "session";

type AuthLinkProblem = {
  title: string;
  message: string;
};

const AUTH_QUERY_KEYS = ["code", "error", "error_code", "error_description"];

function asFlow(value: string | null): AuthLinkFlow {
  if (value === "invite" || value === "recovery" || value === "email") return value;
  return "unknown";
}

function getLinkParams() {
  const url = new URL(window.location.href);
  const rawHash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const hash = new URLSearchParams(rawHash);
  const type = asFlow(hash.get("type") ?? url.searchParams.get("type"));

  return {
    url,
    code: url.searchParams.get("code"),
    redirectError: hash.get("error_code") ?? url.searchParams.get("error_code") ?? hash.get("error") ?? url.searchParams.get("error"),
    tokenHash: hash.get("token_hash"),
    type,
    accessToken: hash.get("access_token"),
    refreshToken: hash.get("refresh_token"),
  };
}

function cleanAuthValuesFromUrl(url: URL) {
  try {
    for (const key of AUTH_QUERY_KEYS) url.searchParams.delete(key);
    const query = url.searchParams.toString();
    window.history.replaceState(null, "", `${url.pathname}${query ? `?${query}` : ""}`);
  } catch {
    // URL cleanup is best-effort and must not block password setup.
  }
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const rawCode = (error as { code?: unknown }).code;
    if (typeof rawCode === "string" && /^[a-z0-9_-]{1,80}$/i.test(rawCode)) return rawCode.toLowerCase();

    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      const normalized = message.toLowerCase();
      if (normalized.includes("code verifier")) return "bad_code_verifier";
      if (normalized.includes("expired")) return "otp_expired";
    }
  }
  return fallback;
}

function linkProblemFor(code: string, flow: AuthLinkFlow): AuthLinkProblem {
  switch (code) {
    case "otp_expired":
      return {
        title: "This link has expired or was already used",
        message: "For your security, invitation and password links work once and expire after 24 hours. Request a fresh link below.",
      };
    case "flow_state_expired":
    case "flow_state_not_found":
    case "bad_code_verifier":
      return {
        title: "This link cannot be used in this browser",
        message: "Open the link in the browser where it was requested, or request a fresh link below.",
      };
    case "access_denied":
      return {
        title: "This link was not accepted",
        message: "The invitation or password request may have been cancelled. Request a fresh link to continue.",
      };
    default:
      return {
        title: flow === "invite" ? "This invitation link is not valid" : "This password link is not valid",
        message: "The link may have expired, already been used, or been copied incorrectly. Request a fresh link below.",
      };
  }
}

async function reportAuthLinkError(flow: AuthLinkFlow, stage: AuthLinkStage, errorCode: string) {
  const sanitizedCode = /^[a-z0-9_-]{1,80}$/i.test(errorCode) ? errorCode.toLowerCase() : "unknown_auth_link_error";
  try {
    await fetch("/api/auth/link-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flow, stage, error_code: sanitizedCode }),
      keepalive: true,
    });
  } catch {
    // Diagnostics are best-effort and must never block recovery.
  }
}

export default function ResetPasswordPage() {
  const [isReady, setIsReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [flow, setFlow] = useState<AuthLinkFlow>("unknown");
  const [linkProblem, setLinkProblem] = useState<AuthLinkProblem | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordsMatch = useMemo(() => password.length > 0 && password === confirmPassword, [password, confirmPassword]);

  useEffect(() => {
    let cancelled = false;

    async function failLink(nextFlow: AuthLinkFlow, stage: AuthLinkStage, code: string) {
      const sanitizedCode = /^[a-z0-9_-]{1,80}$/i.test(code) ? code.toLowerCase() : "unknown_auth_link_error";
      console.warn("Authentication link could not be verified", { flow: nextFlow, stage, code: sanitizedCode });
      void reportAuthLinkError(nextFlow, stage, sanitizedCode);
      if (!cancelled) {
        setHasSession(false);
        setLinkProblem(linkProblemFor(sanitizedCode, nextFlow));
      }
    }

    async function init() {
      let currentFlow: AuthLinkFlow = "unknown";
      setError(null);
      setLinkProblem(null);

      try {
        // Links can arrive as a PKCE code, a token hash, or legacy full tokens.
        const { url, code, redirectError, tokenHash, type, accessToken, refreshToken } = getLinkParams();
        currentFlow = type;
        setFlow(type);

        if (redirectError) {
          cleanAuthValuesFromUrl(url);
          try {
            await supabase.auth.signOut();
          } catch {
            // ignore stale-session cleanup errors
          }
          await failLink(type, "redirect", safeErrorCode({ code: redirectError }, "auth_link_rejected"));
          return;
        }

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          cleanAuthValuesFromUrl(url);
          if (exchangeError) {
            try {
              await supabase.auth.signOut();
            } catch {
              // ignore stale-session cleanup errors
            }
            await failLink(type, "code_exchange", safeErrorCode(exchangeError, "code_exchange_failed"));
            return;
          }
        } else if (tokenHash && type !== "unknown") {
          try {
            await supabase.auth.signOut();
          } catch {
            // ignore stale-session cleanup errors
          }

          const { error: verificationError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type,
          });
          cleanAuthValuesFromUrl(url);

          if (verificationError) {
            await failLink(type, "verify_otp", safeErrorCode(verificationError, "otp_verification_failed"));
            return;
          }
        } else if (accessToken && refreshToken) {
          try {
            await supabase.auth.signOut();
          } catch {
            // ignore stale-session cleanup errors
          }

          const { error: sessionStartError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          cleanAuthValuesFromUrl(url);

          if (sessionStartError) {
            await failLink(type, "session", safeErrorCode(sessionStartError, "session_start_failed"));
            return;
          }
        }

        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          await failLink(type, "session", safeErrorCode(sessionError, "session_read_failed"));
          return;
        }
        if (cancelled) return;

        const sessionExists = Boolean(data.session);
        setHasSession(sessionExists);
        if (!sessionExists) setLinkProblem(linkProblemFor("missing_session", type));
      } catch (caught) {
        await failLink(currentFlow, "session", safeErrorCode(caught, "auth_link_initialization_failed"));
      } finally {
        if (!cancelled) setIsReady(true);
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!passwordsMatch) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setIsSaving(true);
    try {
      // A direct REST update avoids a client auth-lock edge case that could leave this form waiting indefinitely.
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session?.access_token) {
        throw new Error("No active password session. Please request a new link.");
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !anonKey) throw new Error("Password service configuration is unavailable.");

      const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({} as Record<string, unknown>));
        const message =
          (typeof body.error_description === "string" && body.error_description) ||
          (typeof body.message === "string" && body.message) ||
          "Failed to update password";
        throw new Error(message);
      }

      // Invited users become active after their first successful password setup.
      try {
        await fetch("/api/me/activate", { method: "POST" });
      } catch {
        // activation is idempotent and best-effort for existing users
      }

      window.location.assign("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to update password");
      setIsSaving(false);
    }
  }

  const pageTitle = flow === "invite" ? "Set your password" : "Reset password";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft size={16} />
          Back to Login
        </Link>
      </header>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-bold text-foreground">{pageTitle}</h1>
            <p className="text-muted-foreground">Choose a new password for your account.</p>
          </div>

          {error && hasSession ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : null}

          <div className="rounded-lg border bg-card p-6">
            {!isReady ? (
              <div className="text-sm text-muted-foreground">Checking your secure link...</div>
            ) : !hasSession ? (
              <div className="space-y-5">
                <div className="flex gap-3">
                  <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
                  <div className="space-y-1">
                    <h2 className="font-semibold text-foreground">{linkProblem?.title ?? "This link is not valid"}</h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {linkProblem?.message ?? "Request a fresh link to continue."}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button asChild className="sm:flex-1">
                    <Link href="/forgot-password">Request new link</Link>
                  </Button>
                  <Button asChild variant="outline" className="sm:flex-1">
                    <Link href="/">Back to login</Link>
                  </Button>
                </div>

                <p className="text-xs leading-5 text-muted-foreground">
                  Still having trouble? Contact{" "}
                  <a className="font-medium text-primary hover:underline" href="mailto:support@smartapprentice.app">
                    support@smartapprentice.app
                  </a>
                  .
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={isSaving}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm new password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    disabled={isSaving}
                    required
                  />
                </div>

                <Button className="w-full" type="submit" disabled={isSaving}>
                  {isSaving ? "Saving..." : "Update password"}
                </Button>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
