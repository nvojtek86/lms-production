'use client';

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Mail, Lock } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { useSearchParams } from "next/navigation";

export function LoginForm() {
  const searchParams = useSearchParams();
  const notice = searchParams.get('notice');
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [slowNotice, setSlowNotice] = useState(false);
  const [switchPrompt, setSwitchPrompt] = useState<{ currentEmail: string; targetEmail: string } | null>(null);
  const pendingCredsRef = useRef<{ email: string; password: string } | null>(null);
  const slowTimerRef = useRef<number | null>(null);
  const hardFailTimerRef = useRef<number | null>(null);

  function clearWatchdog() {
    if (slowTimerRef.current) window.clearTimeout(slowTimerRef.current);
    if (hardFailTimerRef.current) window.clearTimeout(hardFailTimerRef.current);
    slowTimerRef.current = null;
    hardFailTimerRef.current = null;
    setSlowNotice(false);
  }

  function startWatchdog() {
    clearWatchdog();
    // After 12s, show a non-blocking notice but keep loading.
    slowTimerRef.current = window.setTimeout(() => {
      setSlowNotice(true);
    }, 12_000);

    // Only hard-fail after a longer timeout (covers slow networks/browsers like Firefox).
    hardFailTimerRef.current = window.setTimeout(() => {
      setIsLoading(false);
      setError("Sign-in is taking too long. Please try again.");
    }, 60_000);
  }

  async function resetSessionBestEffort() {
    // Clear server cookies + any lingering client auth state.
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }

    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }

    // Extra cleanup for legacy/localStorage-based auth (if it ever existed in older builds).
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (typeof k === "string") keys.push(k);
      }
      for (const k of keys) {
        if (/^sb-.*-auth-token$/i.test(k)) localStorage.removeItem(k);
        if (k === "supabase.auth.token") localStorage.removeItem(k);
      }
    } catch {
      // ignore
    }
  }

  // If Supabase ever redirects recovery/invite users to "/" (site URL),
  // forward them to /reset-password so they can set a password.
  useEffect(() => {
    const url = new URL(window.location.href);
    const hasCode = url.searchParams.get("code");
    const hasQueryError = url.searchParams.has("error") || url.searchParams.has("error_code");
    const hasHashTokens =
      window.location.hash.includes("token_hash=") ||
      window.location.hash.includes("access_token=") ||
      window.location.hash.includes("refresh_token=") ||
      window.location.hash.includes("error_code=") ||
      window.location.hash.includes("error=");
    if (hasCode || hasQueryError || hasHashTokens) {
      window.location.replace(`/reset-password${window.location.search}${window.location.hash}`);
    }
  }, []);

  // Cleanup watchdog on unmount.
  useEffect(() => {
    return () => clearWatchdog();
  }, []);

  async function doSignIn(email: string, pwd: string) {
    // Login with Supabase
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password: pwd,
    });

    if (authError) {
      setError("Invalid email or password.");
      setPassword("");
      return;
    }

    // Fetch user role + active flag from database.
    // IMPORTANT: do NOT use .single() here.
    // Disabled users may be hidden by RLS, which can cause PostgREST 406 (PGRST116) with .single().
    const { data: rows, error: dbError } = await supabase
      .from('users')
      .select('role, organization_id, is_active')
      .eq('id', authData.user.id)
      .limit(1);

    if (dbError) {
      throw new Error('Failed to fetch user role');
    }

    const dbUser = Array.isArray(rows) ? rows[0] : null;

    // If the row is not visible, it’s usually because the account is disabled (or not provisioned).
    if (!dbUser) {
      await resetSessionBestEffort();
      throw new Error("Your account is currently disabled. Please contact your administrator if you believe this is a mistake.");
    }

    // If RLS ever allows reading disabled users, keep this explicit check too.
    if ((dbUser as { is_active?: boolean | null }).is_active === false) {
      await resetSessionBestEffort();
      throw new Error("Your account is currently disabled. Please contact your administrator if you believe this is a mistake.");
    }

    // Check if there's a redirect URL from the query params
    const redirectTo = searchParams.get('redirect');
    
    // Determine target URL based on role
    let targetUrl = '/';
    let orgSlug: string | null = null;
    if ((dbUser.role === 'organization_admin' || dbUser.role === 'member') && dbUser.organization_id) {
      try {
        const { data: orgRow } = await supabase
          .from('organizations')
          .select('slug')
          .eq('id', dbUser.organization_id)
          .maybeSingle();
        const raw = (orgRow as { slug?: unknown } | null)?.slug;
        orgSlug = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
      } catch {
        orgSlug = null;
      }
    }
    
    if (redirectTo) {
      targetUrl = redirectTo;
    } else {
      switch (dbUser.role) {
        case 'super_admin':
          targetUrl = '/admin';
          break;
        case 'system_admin':
          targetUrl = '/system';
          break;
        case 'organization_admin':
        case 'member':
          targetUrl = dbUser.organization_id ? `/org/${orgSlug ?? dbUser.organization_id}` : '/';
          break;
        default:
          targetUrl = '/';
      }
    }

    // Hard redirect:
    // - Ensures the edge proxy re-evaluates cookies immediately
    // - Avoids "stuck on Signing in..." if client navigation gets bounced
    clearWatchdog();
    window.location.assign(targetUrl);
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSwitchPrompt(null);
    setIsLoading(true);
    startWatchdog();

    // Autofill fallback: some browsers/password managers fill inputs without firing React onChange,
    // so state can be empty even when the user sees values on screen.
    const form = e.currentTarget;
    const emailFromDom =
      (form.elements.namedItem("email") as HTMLInputElement | null)?.value ?? "";
    const passwordFromDom =
      (form.elements.namedItem("password") as HTMLInputElement | null)?.value ?? "";

    const email = (emailFromDom || username).trim();
    const pwd = passwordFromDom || password;

    // Friendly validation (prevents Supabase 400 + noisy console errors)
    if (!email || !pwd) {
      setError("Please enter your email and password.");
      setIsLoading(false);
      clearWatchdog();
      return;
    }

    try {
      // If a different user is already signed in in this browser, require switching first.
      // (This avoids confusing mixed-session states and prevents "Signing in..." hangs.)
      const { data: sessionData } = await supabase.auth.getSession();
      const existingEmail = (sessionData.session?.user?.email ?? "").trim().toLowerCase() || null;
      const targetEmail = email.toLowerCase();

      if (existingEmail && existingEmail !== targetEmail) {
        pendingCredsRef.current = { email, password: pwd };
        setSwitchPrompt({ currentEmail: existingEmail, targetEmail: email });
        setIsLoading(false);
        clearWatchdog();
        return;
      }

      await doSignIn(email, pwd);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to login";
      setError(errorMessage);
      // Clear password on unexpected errors for security
      setPassword("");
    } finally {
      // If we hard-redirected, this component will be replaced. If we stayed here, stop loading.
      setIsLoading(false);
      clearWatchdog();
    }
  };

  return (
    <div className="w-full max-w-md space-y-8">
      {/* Title */}
      <div className="text-center">
        <h1 className="text-4xl font-bold text-primary">Login</h1>
      </div>

      {notice === 'invite-only' && (
        <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-center text-foreground">
          This LMS is <span className="font-medium">invite-only</span>. Please contact your administrator to receive an invitation email.
        </div>
      )}

      {notice === 'disabled' && (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-center text-foreground">
          Your account is currently <span className="font-medium">disabled</span>. Please contact your administrator if you believe this is a mistake.
        </div>
      )}

      {switchPrompt ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-medium">Switch account required</div>
          <div className="mt-1">
            You’re currently signed in as <span className="font-medium">{switchPrompt.currentEmail}</span>. To sign in as{" "}
            <span className="font-medium">{switchPrompt.targetEmail}</span>, click <span className="font-medium">Switch account</span>.
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isLoading}
              onClick={() => {
                pendingCredsRef.current = null;
                setSwitchPrompt(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isLoading}
              onClick={async () => {
                const creds = pendingCredsRef.current;
                if (!creds) {
                  setSwitchPrompt(null);
                  return;
                }
                setError("");
                setIsLoading(true);
                startWatchdog();
                try {
                  await resetSessionBestEffort();
                  setSwitchPrompt(null);
                  pendingCredsRef.current = null;
                  await doSignIn(creds.email, creds.password);
                } catch (e) {
                  const msg = e instanceof Error ? e.message : "Failed to switch account";
                  setError(msg);
                } finally {
                  setIsLoading(false);
                  clearWatchdog();
                }
              }}
            >
              Switch account
            </Button>
          </div>
        </div>
      ) : null}

      {/* Error Message */}
      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md text-sm text-center">
          {error}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Username/Email Field */}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="Enter your email"
              autoComplete="email"
              autoCapitalize="none"
              inputMode="email"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
              className="pl-10"
              required
              disabled={isLoading}
            />
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* Password Field */}
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="Enter your password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
              className="pl-10"
              required
              disabled={isLoading}
            />
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* Submit Button */}
        <Button 
          type="submit" 
          className="w-full h-11"
          disabled={isLoading || !!switchPrompt}
        >
          {isLoading ? "Signing in..." : "Sign In"}
        </Button>

        {isLoading && slowNotice ? (
          <div className="text-xs text-muted-foreground text-center">
            Still signing you in… (this can take up to a minute on slow networks/browsers)
          </div>
        ) : null}
      </form>

      {/* Links */}
      <div className="text-center space-y-2">
        <Link 
          href="/forgot-password" 
          className="text-sm text-primary hover:underline block"
        >
          Forgot password?
        </Link>
        <Link 
          href="/support" 
          className="text-sm text-primary hover:underline block"
        >
          Contact Support
        </Link>
      </div>
    </div>
  );
}
