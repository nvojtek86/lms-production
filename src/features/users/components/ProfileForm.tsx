'use client';
import {useUi} from "@/i18n/useUi";


import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { fetchJson } from "@/lib/api";

type MeResponse = {
  user: {
    id: string;
    email: string;
    role: string;
    organization_id: string | null;
    organization_name?: string | null;
    organization_slug?: string | null;
    full_name: string | null;
    avatar_url?: string | null;
  };
};

function normalizeFullName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export function ProfileForm() {
  const ui = useUi();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [fullName, setFullName] = useState("");
  const [originalFullName, setOriginalFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [organizationDisplay, setOrganizationDisplay] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isRemovingAvatar, setIsRemovingAvatar] = useState(false);
  const [isDraggingAvatar, setIsDraggingAvatar] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [presetAvatars, setPresetAvatars] = useState<Array<{ name: string; url: string }>>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);
  const [isSettingPreset, setIsSettingPreset] = useState(false);
  const [isPresetPickerOpen, setIsPresetPickerOpen] = useState(false);
  const presetPickerRef = useRef<HTMLDivElement | null>(null);
  const [isEditingInfo, setIsEditingInfo] = useState(false);

  function roleDisplayName(value: string): string {
    switch (value) {
      case "super_admin":
        return "Super Administrator/Developer";
      case "system_admin":
        return "System Administrator";
      case "organization_admin":
        return "Organization Administrator";
      case "member":
        return "Member";
      default:
        return value || "—";
    }
  }

  const profileSubtitle = useMemo(() => {
    if (role === "organization_admin" && organizationDisplay) {
      return `${roleDisplayName(role)}, ${organizationDisplay}`;
    }
    return roleDisplayName(role);
  }, [organizationDisplay, role]);

  const isDirty = useMemo(() => {
    const nameDirty = normalizeFullName(fullName) !== normalizeFullName(originalFullName);
    return nameDirty;
  }, [fullName, originalFullName]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      setSuccess(null);
      try {
        const { data: body } = await fetchJson<MeResponse>("/api/me", { cache: "no-store" });
        if (cancelled) return;

        const u = body.user!;
        setEmail(u.email || "");
        setRole(u.role || "");
        const initial = u.full_name ?? "";
        setFullName(initial);
        setOriginalFullName(initial);
        setAvatarUrl((u as { avatar_url?: string | null }).avatar_url ?? null);
        const orgNameRaw = (u as { organization_name?: string | null }).organization_name ?? null;
        const orgSlugRaw = (u as { organization_slug?: string | null }).organization_slug ?? null;
        const nextOrg =
          (typeof orgNameRaw === "string" && orgNameRaw.trim().length ? orgNameRaw.trim() : null) ??
          (typeof orgSlugRaw === "string" && orgSlugRaw.trim().length ? orgSlugRaw.trim() : null);
        setOrganizationDisplay(nextOrg);
      } catch (e) {
        if (!cancelled) setError(ui(e instanceof Error ? e.message : "Failed to load profile"));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [ui]);

  useEffect(() => {
    let cancelled = false;
    async function loadPresets() {
      setIsLoadingPresets(true);
      try {
        const { data: body } = await fetchJson<{ presets: Array<{ name: string; url: string }> }>("/api/avatar-presets", {
          cache: "no-store",
        });
        if (cancelled) return;
        setPresetAvatars(Array.isArray(body.presets) ? body.presets : []);
      } catch {
        // non-fatal
      } finally {
        if (!cancelled) setIsLoadingPresets(false);
      }
    }

    void loadPresets();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setError(null);
    setSuccess(null);
    setIsSaving(true);
    const t = toast.loading(ui("Saving profile…"));
    try {
      const name = normalizeFullName(fullName);

      let profileMessage: string | null = null;
      if (normalizeFullName(fullName) !== normalizeFullName(originalFullName)) {
        const { data: body, message } = await fetchJson<MeResponse>("/api/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ full_name: name.length ? name : null }),
        });

        const saved = body.user?.full_name ?? "";
        setFullName(saved);
        setOriginalFullName(saved);
        setAvatarUrl((body.user as { avatar_url?: string | null } | undefined)?.avatar_url ?? avatarUrl);
        profileMessage = message || "Profile saved.";
      }

      const finalMsg = profileMessage || "Saved.";
      setSuccess(ui(finalMsg));
      toast.success(ui(finalMsg), { id: t });
      setIsEditingInfo(false);

      // Let the rest of the app refresh user state + server components.
      window.dispatchEvent(new Event("profile:updated"));
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      setError(ui(msg));
      toast.error(ui(msg), { id: t });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSendResetPassword() {
    if (isSendingReset) return;
    setError(null);
    setSuccess(null);
    setIsSendingReset(true);
    const t = toast.loading(ui("Sending reset password link…"));
    try {
      const { message } = await fetchJson<{ ok: true }>("/api/me/password-reset", { method: "POST" });
      toast.success(ui(message || "Reset password link sent."), { id: t });
      setSuccess(ui(message || "Reset password link sent."));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to send reset password link";
      setError(ui(msg));
      toast.error(ui(msg), { id: t });
    } finally {
      setIsSendingReset(false);
    }
  }

  async function handleUploadAvatar(file?: File) {
    const fileToUpload = file ?? avatarFile;
    if (!fileToUpload) return;
    setError(null);
    setSuccess(null);
    setIsUploadingAvatar(true);
    const t = toast.loading(ui("Uploading profile photo…"));
    try {
      const form = new FormData();
      form.append("file", fileToUpload);
      const { data: body, message } = await fetchJson<{ avatar_url: string | null }>("/api/me/avatar", { method: "POST", body: form });

      setAvatarUrl(body.avatar_url ?? null);
      setAvatarFile(null);
      setSuccess(ui(message || "Avatar updated."));
      toast.success(ui(message || "Profile photo updated."), { id: t });
      window.dispatchEvent(new Event("profile:updated"));
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to upload avatar";
      setError(ui(msg));
      toast.error(ui(msg), { id: t });
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  function handleAvatarDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingAvatar(false);
    if (isUploadingAvatar || isLoading || isSaving || isRemovingAvatar || isSettingPreset) return;

    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(ui("Please drop an image file."));
      return;
    }
    setAvatarFile(file);
    void handleUploadAvatar(file);
  }

  async function handleRemoveAvatar() {
    setError(null);
    setSuccess(null);
    setIsRemovingAvatar(true);
    const t = toast.loading(ui("Removing profile photo…"));
    try {
      const { message } = await fetchJson<{ avatar_url: null }>("/api/me/avatar", { method: "DELETE" });

      setAvatarUrl(null);
      setAvatarFile(null);
      setSuccess(ui(message || "Avatar removed."));
      toast.success(ui(message || "Profile photo removed."), { id: t });
      window.dispatchEvent(new Event("profile:updated"));
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to remove avatar";
      setError(ui(msg));
      toast.error(ui(msg), { id: t });
    } finally {
      setIsRemovingAvatar(false);
    }
  }

  async function handleSetPreset(name: string) {
    setError(null);
    setSuccess(null);
    setIsSettingPreset(true);
    const t = toast.loading(ui("Setting preset avatar…"));
    try {
      const { data: body, message } = await fetchJson<{ avatar_url: string | null }>("/api/me/avatar-preset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setAvatarUrl(body.avatar_url ?? null);
      setAvatarFile(null);
      setSuccess(ui(message || "Avatar updated."));
      toast.success(ui(message || "Profile photo updated."), { id: t });
      setIsPresetPickerOpen(false);
      window.dispatchEvent(new Event("profile:updated"));
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to set avatar preset";
      setError(ui(msg));
      toast.error(ui(msg), { id: t });
    } finally {
      setIsSettingPreset(false);
    }
  }

  // Close preset picker on outside click / escape
  useEffect(() => {
    if (!isPresetPickerOpen) return;

    const onMouseDown = (e: MouseEvent) => {
      const el = presetPickerRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setIsPresetPickerOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsPresetPickerOpen(false);
    };

    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isPresetPickerOpen]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{ui("My Profile")}</h1>
        <p className="text-muted-foreground">{ui("Update your account details.")}</p>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {ui(error)}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {success}
        </div>
      ) : null}

      {/* Profile overview */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={ui("Avatar")} className="h-16 w-16 rounded-full object-cover border" />
            ) : (
              <div className="h-16 w-16 rounded-full border flex items-center justify-center text-sm text-muted-foreground">
                —
              </div>
            )}
            <div className="min-w-0">
              <div className="text-lg font-semibold text-foreground truncate">
                {normalizeFullName(fullName).length ? normalizeFullName(fullName) : email}
              </div>
              <div className="text-sm text-muted-foreground truncate">{profileSubtitle}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
        {/* Profile photo */}
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">{ui("Profile photo")}</h2>
              <p className="text-sm text-muted-foreground">{ui("Upload a photo or choose a preset avatar.")}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!avatarUrl || isLoading || isSaving || isUploadingAvatar || isRemovingAvatar || isSettingPreset}
              onClick={handleRemoveAvatar}
            >
              {isRemovingAvatar ? ui("Removing...") : ui("Remove")}
            </Button>
          </div>

          <div
            className={`rounded-md border border-dashed px-4 py-4 transition cursor-pointer ${
              isDraggingAvatar ? "border-primary bg-primary/10" : "border-muted-foreground/30 bg-muted/40"
            }`}
            role="button"
            tabIndex={0}
            aria-label={ui("Upload profile photo")}
            onClick={() => avatarInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                avatarInputRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!isUploadingAvatar && !isLoading && !isSaving && !isRemovingAvatar && !isSettingPreset) {
                setIsDraggingAvatar(true);
              }
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsDraggingAvatar(false);
            }}
            onDrop={handleAvatarDrop}
          >
            <div className="flex items-center gap-4">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt={ui("Avatar")} className="h-14 w-14 rounded-full object-cover border bg-background" />
              ) : (
                <div className="h-14 w-14 rounded-full border flex items-center justify-center text-xs text-muted-foreground bg-background">
                  —
                </div>
              )}

              <div className="min-w-0">
                <div className="font-medium text-foreground">
                  {ui("Drag & drop a photo here, or click to browse")}</div>
                <div className="text-xs text-muted-foreground">
                  {ui("PNG / JPG / WebP, max 2MB.")}</div>
                {isUploadingAvatar ? (
                  <div className="mt-1 text-xs text-muted-foreground">{ui("Uploading…")}</div>
                ) : null}
              </div>

              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/webp,image/jpeg,image/jpg"
                className="hidden"
                disabled={isLoading || isSaving || isUploadingAvatar || isRemovingAvatar || isSettingPreset}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (!f) return;
                  setAvatarFile(f);
                  void handleUploadAvatar(f);
                  // allow selecting the same file again
                  e.currentTarget.value = "";
                }}
              />
            </div>
          </div>

          {/* Preset avatar */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="h-0 flex-1 border-t border-dashed border-muted-foreground/40" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{ui("OR")}</span>
              <div className="h-0 flex-1 border-t border-dashed border-muted-foreground/40" />
            </div>

            <Label>{ui("Preset avatar")}</Label>
            {isLoadingPresets ? (
              <div className="text-sm text-muted-foreground">{ui("Loading presets…")}</div>
            ) : presetAvatars.length === 0 ? (
              <div className="text-sm text-muted-foreground">{ui("No preset avatars available.")}</div>
            ) : (
              <div ref={presetPickerRef} className="relative">
                {(() => {
                  const firstPreset = presetAvatars[0]?.url ?? null;
                  const previewUrl = avatarUrl ?? firstPreset;
                  const isDisabled = isLoading || isSaving || isUploadingAvatar || isRemovingAvatar || isSettingPreset;

                  return (
                    <>
                      <button
                        type="button"
                        className={`w-auto min-w-[195px] inline-flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 transition hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-2 focus-visible:ring-offset-background cursor-pointer ${
                          isDisabled ? "opacity-60 cursor-not-allowed" : ""
                        }`}
                        disabled={isDisabled}
                        onClick={() => setIsPresetPickerOpen((v) => !v)}
                        aria-label={ui("Choose a preset avatar")}
                        aria-expanded={isPresetPickerOpen}
                      >
                        <span className="inline-flex items-center gap-3">
                          {previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={previewUrl} alt={ui("Preset avatar")} className="h-10 w-10 rounded-full object-cover border" />
                          ) : (
                            <div className="h-10 w-10 rounded-full border flex items-center justify-center text-xs text-muted-foreground">
                              —
                            </div>
                          )}
                          <span className="text-sm text-muted-foreground">
                            {isPresetPickerOpen ? ui("Close presets") : ui("Choose preset")}
                          </span>
                        </span>
                        <ChevronDown
                          className={`h-4 w-4 text-muted-foreground transition-transform ${isPresetPickerOpen ? "rotate-180" : ""}`}
                        />
                      </button>
                      <p className="mt-1 text-xs text-muted-foreground">{ui("Click to choose a preset.")}</p>

                      {isPresetPickerOpen ? (
                        <div className="absolute z-20 mt-2 w-[415px] max-w-[90vw] rounded-lg border bg-background shadow-lg p-3">
                          <div className="grid grid-cols-7 gap-2">
                            {presetAvatars.map((p) => {
                              const isActive = !!avatarUrl && (avatarUrl === p.url || avatarUrl.endsWith(p.url));
                              return (
                                <button
                                  key={p.name}
                                  type="button"
                                  className={`rounded-full border p-0.5 transition-colors hover:cursor-pointer m-auto ${
                                    isActive ? "border-primary" : "border-transparent hover:border-muted-foreground/30"
                                  } ${isSettingPreset ? "opacity-60 cursor-not-allowed" : ""}`}
                                  disabled={isDisabled}
                                  onClick={() => handleSetPreset(p.name)}
                                  title={p.name}
                                  aria-label={ui("Use preset avatar {v0}", {v0: p.name})}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={p.url} alt={p.name} className="h-10 w-10 rounded-full object-cover" />
                                </button>
                              );
                            })}
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {ui("Presets are built-in (no upload needed).")}</p>
                        </div>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>

        {/* Personal information */}
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">{ui("Personal information")}</h2>
              <p className="text-sm text-muted-foreground">{ui("Update your name. Email and role are read-only.")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isLoading || isSaving || isUploadingAvatar || isRemovingAvatar || isSettingPreset || isSendingReset}
                onClick={() => void handleSendResetPassword()}
              >
                {isSendingReset ? ui("Sending…") : ui("Reset Password")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isLoading || isSaving}
                onClick={() => setIsEditingInfo((v) => !v)}
              >
                {isEditingInfo ? ui("Close") : ui("Edit")}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">{ui("Email")}</Label>
              <Input id="email" value={email} disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">{ui("Role")}</Label>
              <Input id="role" value={role} disabled />
            </div>
          </div>

          {role === "organization_admin" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="orgName">{ui("Organization name")}</Label>
                <div className="rounded-md border bg-background px-3 py-2 text-sm text-foreground">
                  {organizationDisplay ?? "—"}
                </div>
                <p className="text-xs text-muted-foreground">
                  {ui("To rename your organization, go to Settings.")}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fullName">{ui("Administrator's Full Name (optional)")}</Label>
                {isEditingInfo ? (
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={ui("e.g. John Smith")}
                    disabled={isLoading || isSaving}
                    className="border-primary/40 ring-1 ring-primary/15 focus-visible:ring-2 focus-visible:ring-primary/25 transition-shadow"
                  />
                ) : (
                  <div className="rounded-md border bg-background px-3 py-2 text-sm text-foreground">
                    {normalizeFullName(fullName).length ? normalizeFullName(fullName) : "—"}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {ui("This is used for greetings like “Welcome back, John Smith”.")}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="fullName">{ui("Full Name (optional)")}</Label>
              {isEditingInfo ? (
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={ui("e.g. John Smith")}
                  disabled={isLoading || isSaving}
                  className="border-primary/40 ring-1 ring-primary/15 focus-visible:ring-2 focus-visible:ring-primary/25 transition-shadow"
                />
              ) : (
                <div className="rounded-md border bg-background px-3 py-2 text-sm text-foreground">
                  {normalizeFullName(fullName).length ? normalizeFullName(fullName) : "—"}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {ui("This is used for greetings like “Welcome back, John Smith”.")}</p>
            </div>
          )}

          {isEditingInfo ? (
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={isLoading || isSaving}
                onClick={() => {
                  setFullName(originalFullName);
                  setSuccess(null);
                  setError(null);
                  setIsEditingInfo(false);
                }}
              >
                {ui("Cancel")}</Button>
              <Button type="button" disabled={isLoading || isSaving || !isDirty} onClick={handleSave}>
                {isSaving ? ui("Saving...") : ui("Save")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}


