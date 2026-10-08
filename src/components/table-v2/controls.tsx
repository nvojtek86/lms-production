"use client";
import {useUi} from "@/i18n/useUi";



import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type FilterDropdownId = string;

export function HelpText({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`mt-1 text-xs text-muted-foreground ${className ?? ""}`}>{children}</div>;
}

export function FilterSelect<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const ui = useUi();
  return (
    <div className={`relative ${props.className ?? ""}`}>
      <select
        aria-label={props.ariaLabel}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as T)}
        disabled={props.disabled}
        className={`
          h-9 w-full appearance-none rounded-md border bg-background pl-3 pr-8 text-sm
          shadow-xs transition-colors
          hover:bg-muted/20 hover:cursor-pointer
          disabled:opacity-60 disabled:cursor-not-allowed
        `}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {ui.optionLabel(o.label, o.value)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export function UnderlineDropdown<T extends string>({
  id,
  label,
  value,
  options,
  open,
  onToggle,
  onSelect,
  disabled,
}: {
  id: FilterDropdownId;
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  open: boolean;
  onToggle: () => void;
  onSelect: (v: T) => void;
  disabled?: boolean;
}) {
  const ui = useUi();
  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";

  return (
    <div className="min-w-[180px]">
      <div className="text-xs text-muted-foreground mb-1">{ui(label)}</div>
      <div data-filter-dropdown={id} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            onToggle();
          }}
          className={`
            w-full flex items-center justify-between gap-3
            border-b border-primary
            pb-2 text-sm
            ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}
          `}
        >
          <span className="min-w-0 truncate text-foreground">{ui.optionLabel(selectedLabel, value)}</span>
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground">
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </span>
        </button>

        {open ? (
          <div className="absolute left-0 mt-2 w-full rounded-sm border bg-background shadow-lg overflow-hidden z-50">
            {options.map((o) => {
              const active = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onSelect(o.value)}
                  className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                    active ? "bg-primary text-white" : "text-foreground cursor-pointer"
                  } hover:bg-primary/90 hover:text-white`}
                >
                  {ui.optionLabel(o.label, o.value)}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

