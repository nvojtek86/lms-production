"use client";
import {useUi} from "@/i18n/useUi";


import { useRef, useState } from "react";
import { Pencil, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { fetchJson } from "@/lib/api";

type Props = {
  orgId: string;
  orgLabel: string;
  initialOrgName: string;
  callerRole: string;
  initialLogoUrl: string | null;
};

function normalizeOrgName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export default function OrgSettingsClient({ orgId, orgLabel, initialOrgName, callerRole, initialLogoUrl }: Props) {
  const ui = useUi();
  const canRenameOrg = callerRole === "organization_admin";

  const [orgName, setOrgName] = useState<string>(initialOrgName ?? "");
  const [isEditingOrgName, setIsEditingOrgName] = useState(false);
  const [orgNameInput, setOrgNameInput] = useState<string>(initialOrgName ?? "");
  const [isSavingOrgName, setIsSavingOrgName] = useState(false);

  const [logoUrl, setLogoUrl] = useState<string>(initialLogoUrl ?? "");
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isDraggingLogo, setIsDraggingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function saveOrgName(nextName: string) {
    const name = normalizeOrgName(nextName);
    setError(null);
    setSuccess(null);
    setIsSavingOrgName(true);
    const t = toast.loading(ui("Updating organization name…"));
    try {
      const { data: body, message } = await fetchJson<{ organization: { id: string; name: string; slug: string | null } }>(
        "/api/me/organization",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }
      );
      const saved = body.organization?.name ?? name;
      setOrgName(saved);
      setOrgNameInput(saved);
      setIsEditingOrgName(false);
      setSuccess(ui(message || "Organization name updated."));
      toast.success(ui(message || "Organization name updated."), { id: t });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update organization name";
      setError(ui(msg));
      toast.error(ui(msg), { id: t });
    } finally {
      setIsSavingOrgName(false);
    }
  }

  async function uploadLogo(file: File) {
    setError(null);
    setSuccess(null);
    setIsUploading(true);
    const t = toast.loading(ui("Uploading organization logo…"));
    try {
      const form = new FormData();
      form.append("file", file);
      const { data: body, message } = await fetchJson<{ logo_url: string | null }>(`/api/organizations/${orgId}/logo`, {
        method: "POST",
        body: form,
      });
      if (body.logo_url) setLogoUrl(String(body.logo_url));
      setSuccess(ui(message || "Logo uploaded."));
      toast.success(ui(message || "Organization logo uploaded."), { id: t });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to upload logo";
      setError(ui(msg));
      toast.error(ui(msg), { id: t });
    } finally {
      setIsUploading(false);
    }
  }

  async function removeLogo() {
    setError(null);
    setSuccess(null);
    setIsRemoving(true);
    const t = toast.loading(ui("Removing organization logo…"));
    try {
      const { message } = await fetchJson<{ logo_url: null }>(`/api/organizations/${orgId}/logo`, { method: "DELETE" });
      setLogoUrl("");
      setSuccess(ui(message || "Logo removed."));
      toast.success(ui(message || "Organization logo removed."), { id: t });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to remove logo";
      setError(ui(msg));
      toast.error(ui(msg), { id: t });
    } finally {
      setIsRemoving(false);
    }
  }

  function handleLogoDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingLogo(false);
    if (isUploading || isRemoving) return;

    const file = event.dataTransfer.files?.[0];
    if (!file) return;

    const allowed = new Set(["image/png", "image/webp", "image/svg+xml"]);
    if (!allowed.has(file.type)) {
      setError(ui("Please drop a PNG, WebP, or SVG file."));
      toast.error(ui("Please drop a PNG, WebP, or SVG file."));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError(ui("File too large (max 2MB)."));
      toast.error(ui("File too large (max 2MB)."));
      return;
    }

    void uploadLogo(file);
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <Settings className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">{ui("Organization Settings")}</h1>
          <p className="text-muted-foreground">{ui("Manage settings for your organization")}</p>
        </div>
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

      {canRenameOrg ? (
        <div className="bg-card border rounded-lg p-6 shadow-sm">
          <div className="space-y-3">
            <div>
              <Label>{ui("Organization name")}</Label>
              <p className="text-sm text-muted-foreground mt-1">
                {ui("This name is displayed to admins and members. It does not change the organization URL/slug.")}</p>
            </div>

            {isEditingOrgName ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={orgNameInput}
                  onChange={(e) => setOrgNameInput(e.target.value)}
                  disabled={isSavingOrgName}
                  className="h-10 w-full md:w-[420px] rounded-md border bg-background px-3 text-sm"
                  placeholder={ui("e.g. Acme Inc.")}
                />
                <Button
                  type="button"
                  disabled={isSavingOrgName || normalizeOrgName(orgNameInput).length < 2}
                  onClick={() => void saveOrgName(orgNameInput)}
                >
                  {isSavingOrgName ? ui("Saving...") : ui("Save")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSavingOrgName}
                  onClick={() => {
                    setIsEditingOrgName(false);
                    setOrgNameInput(orgName);
                  }}
                >
                  {ui("Cancel")}</Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="rounded-md border bg-background px-3 py-2 text-sm text-foreground min-w-0 truncate">
                  {orgName?.trim().length ? orgName.trim() : orgLabel}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => setIsEditingOrgName(true)}
                >
                  <Pencil className="h-4 w-4" />
                  {ui("Rename")}</Button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="bg-card border rounded-lg p-6 shadow-sm">
        <div className="space-y-4">
          <div>
            <Label>{ui("Organization Logo")}</Label>
            <p className="text-sm text-muted-foreground mt-1">
              {ui("This logo will be shown on the organization dashboard for admins and members in this organization.")}</p>
          </div>

          {/* Current logo preview */}
          <div className="rounded-md border bg-background p-4">
            <div className="text-sm font-medium text-foreground mb-3">{ui("Current logo")}</div>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={ui("Current organization logo")}
                className="h-20 w-48 object-contain rounded-md border bg-muted/30"
              />
            ) : (
              <div className="h-20 w-48 rounded-md border bg-muted/30 flex items-center justify-center text-xs text-muted-foreground text-center px-2">
                {ui("No logo uploaded")}</div>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{ui("Logo upload")}</div>
              <div className="text-xs text-muted-foreground">
                {ui("Drag & drop a logo here, or click to browse. PNG / WebP / SVG, max 2MB.")}</div>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!logoUrl || isUploading || isRemoving}
              onClick={() => void removeLogo()}
            >
              {isRemoving ? ui("Removing...") : ui("Remove")}
            </Button>
          </div>

          <div
            className={`rounded-md border border-dashed px-4 py-4 transition ${
              isDraggingLogo ? "border-primary bg-primary/10" : "border-muted-foreground/30 bg-muted/40"
            }`}
            role="button"
            tabIndex={0}
            aria-label={ui("Upload organization logo")}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!isUploading && !isRemoving) setIsDraggingLogo(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsDraggingLogo(false);
            }}
            onDrop={handleLogoDrop}
          >
            <div className="flex items-center gap-4">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={ui("Organization logo")}
                  className="h-14 w-14 rounded-md object-contain border bg-background"
                />
              ) : (
                <div className="h-14 w-14 rounded-md border flex items-center justify-center text-xs text-muted-foreground bg-background text-center px-1">
                  {(orgName?.trim().length ? orgName.trim() : orgLabel)}
                </div>
              )}

              <div className="min-w-0">
                <div className="font-medium text-foreground">{ui("Drag & drop a logo here, or click to browse")}</div>
                <div className="text-xs text-muted-foreground">{ui("PNG / WebP / SVG, max 2MB.")}</div>
                {isUploading ? <div className="mt-1 text-xs text-muted-foreground">{ui("Uploading…")}</div> : null}
              </div>

              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/webp,image/svg+xml"
                className="hidden"
                disabled={isUploading || isRemoving}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (!f) return;
                  void uploadLogo(f);
                  // allow selecting the same file again
                  e.currentTarget.value = "";
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


