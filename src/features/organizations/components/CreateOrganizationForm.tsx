'use client';
import {useUi} from "@/i18n/useUi";


import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function CreateOrganizationForm({
  onCreate,
}: {
  onCreate: (input: { name: string; slug?: string }) => Promise<void>;
}) {
  const ui = useUi();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestedSlug = useMemo(() => slugify(name), [name]);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setIsSubmitting(true);
        try {
          await onCreate({ name, slug: slug.trim().length > 0 ? slug : suggestedSlug });
          setName("");
          setSlug("");
        } catch (e) {
          setError(ui(e instanceof Error ? e.message : "Failed to create organization"));
        } finally {
          setIsSubmitting(false);
        }
      }}
    >
      {error ? (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {ui(error)}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="orgName">{ui("Organization name")}</Label>
          <Input
            id="orgName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={ui("Acme Corporation")}
            required
            disabled={isSubmitting}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="orgSlug">{ui("Slug")}</Label>
          <Input
            id="orgSlug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={suggestedSlug || "acme"}
            disabled={isSubmitting}
          />
          <p className="text-xs text-muted-foreground">
            {ui("Used in URLs and identifiers. Leave empty to auto-generate.")}</p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? ui("Creating...") : ui("Create Organization")}
        </Button>
      </div>
    </form>
  );
}


