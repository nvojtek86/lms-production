'use client'
import {useUi} from "@/i18n/useUi";


import { useState } from 'react';
import { Button } from '@/components/core/button';
import { userSchema, UserFormData } from '../validations/user.schema';
import type { Role } from '@/types';
import { useOrganizations } from '@/features/organizations';
import { roleLabel } from "@/lib/utils/roleLabel";

interface UserFormProps {
  initialData?: Partial<UserFormData>;
  onSubmit: (data: UserFormData) => Promise<void>;
  onCancel: () => void;
  allowedRoles?: Role[];
  enableOrgPicker?: boolean;
  organizationLabel?: string;
}

export const UserForm = ({
  initialData,
  onSubmit,
  onCancel,
  allowedRoles,
  enableOrgPicker = true,
  organizationLabel,
}: UserFormProps) => {
  const ui = useUi();
  const [formData, setFormData] = useState<Partial<UserFormData>>(initialData || {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const shouldLoadOrgs = enableOrgPicker && !initialData?.organization_id;
  const { organizations, isLoading: orgsLoading, error: orgsError } = useOrganizations({
    enabled: shouldLoadOrgs,
    includeCounts: false,
  });
  const selectedOrg = (organizations ?? []).find((o) => o.id === (formData.organization_id as string | null));
  const selectedOrgIsInactive = !!selectedOrg && selectedOrg.is_active === false;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'organization_id' ? (value.trim().length ? value : null) : value,
    }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    try {
      const validatedData = userSchema.parse(formData);
      setIsSubmitting(true);
      await onSubmit(validatedData);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errors' in err) {
        const zodErr = err as { errors: Array<{ path: string[]; message: string }> };
        const newErrors: Record<string, string> = {};
        zodErr.errors.forEach((error) => {
          newErrors[error.path[0]] = error.message;
        });
        setErrors(newErrors);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">{ui("Full Name (optional)")}</label>
        <input
          type="text"
          name="full_name"
          value={(formData.full_name as string) || ''}
          onChange={handleChange}
          className="w-full px-3 py-2 border rounded-md"
          placeholder={ui("e.g. Nenad Lekic")}
        />
        {errors.full_name && <p className="text-red-500 text-sm mt-1">{ui(errors.full_name)}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">{ui("Email")}</label>
        <input
          type="email"
          name="email"
          value={formData.email || ''}
          onChange={handleChange}
          className="w-full px-3 py-2 border rounded-md"
          disabled={!!initialData?.email}
        />
        {errors.email && <p className="text-red-500 text-sm mt-1">{ui(errors.email)}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">{ui("Role")}</label>
        <select
          name="role"
          value={formData.role || ''}
          onChange={handleChange}
          className="w-full px-3 py-2 border rounded-md"
        >
          <option value="">{ui("Select a role")}</option>
          {(allowedRoles ?? ['member', 'organization_admin', 'system_admin']).map((role) => (
            <option key={role} value={role}>
              {ui(roleLabel(role))}
            </option>
          ))}
        </select>
        {errors.role && <p className="text-red-500 text-sm mt-1">{ui(errors.role)}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">{ui("Organization (Required)")}</label>
        {initialData?.organization_id ? (
          <>
            {/* Keep the real org id in state, but show a human-friendly label to org admins */}
            <input type="hidden" name="organization_id" value={formData.organization_id || ""} readOnly />
            <input
              type="text"
              value={organizationLabel?.trim().length ? organizationLabel : "Organization selected"}
              className="w-full px-3 py-2 border rounded-md bg-muted/30"
              disabled
            />
          </>
        ) : shouldLoadOrgs && !orgsError ? (
          <>
            <select
              name="organization_id"
              value={(formData.organization_id as string) || ''}
              onChange={handleChange}
              className="w-full px-3 py-2 border rounded-md"
              disabled={orgsLoading}
            >
              <option value="">{orgsLoading ? ui("Loading organizations...") : ui("Select an organization")}</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {(o.name?.trim()?.length ? o.name : o.slug?.trim()?.length ? o.slug : o.id) + (o.is_active === false ? ui(" (inactive)") : "")}
                </option>
              ))}
            </select>
            {(formData.organization_id as string | null) && selectedOrgIsInactive ? (
              <div className="mt-2">
                <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 text-xs font-medium">
                  {ui("Inactive org")}</span>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground mt-1">
              {ui("Required for ")}<span className="font-medium">{ui("Member")}</span> / <span className="font-medium">{ui("Organization Admin")}</span>.
            </p>
          </>
        ) : (
          <>
            <input
              type="text"
              name="organization_id"
              value={(formData.organization_id as string) || ''}
              onChange={handleChange}
              className="w-full px-3 py-2 border rounded-md"
              placeholder={ui("Paste organization UUID")}
            />
            {orgsError ? (
              <p className="text-xs text-muted-foreground mt-1">
                {ui("(Org list unavailable: ")}{orgsError.message})
              </p>
            ) : null}
          </>
        )}
        {errors.organization_id && <p className="text-red-500 text-sm mt-1">{ui(errors.organization_id)}</p>}
      </div>

      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          {ui("Cancel")}</Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? ui("Inviting...") : ui("Invite User")}
        </Button>
      </div>
    </form>
  );
};
