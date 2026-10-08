"use client";
import {useUi} from "@/i18n/useUi";


import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AsyncIdCombobox } from "@/features/reporting/components/AsyncIdCombobox";

export function ReportFiltersClient(props: {
  mode: "org" | "system" | "admin";
  orgIdFixed?: string; // for org reports
  initial: {
    q: string;
    result: "all" | "certified" | "not_certified";
    from: string;
    to: string;
    orgId: string;
    orgLabel?: string;
    courseId: string;
    courseLabel?: string;
    userId: string;
    userLabel?: string;
  };
}) {
  const ui = useUi();
  const { mode, orgIdFixed, initial } = props;
  const router = useRouter();
  const pathname = usePathname();

  const onSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fd = new FormData(form);

      // Always reset pagination on filter apply.
      // Keep the URL as the single source of truth (server components read searchParams).
      const params = new URLSearchParams();
      for (const [k, v] of fd.entries()) {
        if (typeof v !== "string") continue;
        const val = v.trim();
        if (!val) continue;

        // Keep URLs tidy (server defaults to these anyway).
        if (k === "result" && val === "all") continue;
        if (k === "page" && val === "1") continue;

        params.set(k, val);
      }
      // Explicitly reset pagination to page 1 on apply.
      params.set("page", "1");

      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname]
  );

  const reset = useCallback(() => {
    // Clear query params by navigating to the same path.
    router.replace(pathname);
  }, [router, pathname]);

  return (
    <div className="bg-card border rounded-lg p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-foreground mb-4">{ui("Filters")}</h2>

      <form onSubmit={onSubmit} className="space-y-4">
        {/* Any filter change should reset pagination */}
        <input type="hidden" name="page" value="1" />

        {/* Row 1: Search (full width) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-muted-foreground mb-1">{ui("Search")}</div>
            <Input name="q" defaultValue={initial.q} placeholder={ui("Email, name, course title...")} />
          </div>

          <div>
              <div className="text-xs text-muted-foreground mb-1">{ui("Certificate")}</div>
              <select
                name="result"
                defaultValue={initial.result}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="all">{ui("All")}</option>
                <option value="certified">{ui("Certified")}</option>
                <option value="not_certified">{ui("Not certified")}</option>
              </select>
            </div>
          </div>

        {/* Row 2: Organizations / Courses / Users */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {mode !== "org" ? (
            <AsyncIdCombobox
              name="orgId"
              label={ui("Organizations")}
              placeholder={ui("Search organizations...")}
              initialId={initial.orgId}
              initialLabel={initial.orgLabel}
              fetchUrl={({ q, page, page_size }) =>
                `/api/report-filters/organizations?q=${encodeURIComponent(q)}&page=${page}&page_size=${page_size}`
              }
            />
          ) : (
            <input type="hidden" name="orgId" value={orgIdFixed ?? ""} />
          )}

          <AsyncIdCombobox
            name="courseId"
            label={ui("Course (draft + archived included)")}
            placeholder={ui("Search courses...")}
            initialId={initial.courseId}
            initialLabel={initial.courseLabel}
            fetchUrl={({ q, page, page_size }) => {
              const orgPart = mode === "org" ? `&organization_id=${encodeURIComponent(orgIdFixed ?? "")}` : "";
              return `/api/report-filters/courses?q=${encodeURIComponent(q)}&page=${page}&page_size=${page_size}${orgPart}`;
            }}
          />

          <AsyncIdCombobox
            name="userId"
            label={ui("Users")}
            placeholder={ui("Search users...")}
            initialId={initial.userId}
            initialLabel={initial.userLabel}
            fetchUrl={({ q, page, page_size }) => {
              const orgPart = mode === "org" ? `&organization_id=${encodeURIComponent(orgIdFixed ?? "")}` : "";
              return `/api/report-filters/users?q=${encodeURIComponent(q)}&page=${page}&page_size=${page_size}${orgPart}`;
            }}
          />
        </div>

        {/* Row 3: Result / From / To */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-muted-foreground mb-1">{ui("From")}</div>
            <Input name="from" type="date" defaultValue={initial.from} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{ui("To")}</div>
            <Input name="to" type="date" defaultValue={initial.to} />
          </div>
        </div>

        {/* Row 4: buttons */}
        <div className="flex gap-2">
          <Button type="submit">{ui("Apply")}</Button>
          <Button type="button" variant="outline" onClick={reset}>
            {ui("Reset")}</Button>
        </div>
      </form>
    </div>
  );
}

