'use client'
import {useUi} from "@/i18n/useUi";


import { useEffect } from "react";
import { Button } from "@/components/core/button";

export function UserTableBulkFilterModal({
  open,
  selectedCount,
  targetOrganizationLabel,
  targetOrgIsInactive,
  onCancel,
  onConfirm,
  isConfirming,
}: {
  open: boolean;
  selectedCount: number;
  targetOrganizationLabel: string;
  targetOrgIsInactive: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  isConfirming?: boolean;
}) {
  const ui = useUi();
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => {
          if (isConfirming) return;
          onCancel();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-lg mx-4 rounded-lg border bg-white shadow-lg"
      >
        <div className="p-5 border-b">
          <h3 className="text-lg font-semibold">{ui("Confirm bulk move")}</h3>
          <p className="mt-1 text-sm text-gray-600">
            {ui("Move ")}<span className="font-medium">{selectedCount}</span>{" "}
            {selectedCount === 1 ? ui("user") : ui("users")} {ui("to")}{" "}
            <span className="font-medium">{targetOrganizationLabel}</span>?
          </p>
          {targetOrgIsInactive ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {ui("These users will be disabled (org is inactive).")}</div>
          ) : null}
        </div>

        <div className="p-5 flex items-center justify-end gap-2">
          <Button
            variant="outline"
            disabled={!!isConfirming}
            onClick={onCancel}
          >
            {ui("Cancel")}</Button>
          <Button disabled={!!isConfirming} onClick={onConfirm}>
            {isConfirming ? ui("Applying…") : ui("Confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}


