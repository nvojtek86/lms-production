import { z } from 'zod';
import { ROLES } from "@/types";

// ============================================
// SHARED ENUMS
// ============================================
export const roleEnum = z.enum(ROLES);

// ============================================
// USER SCHEMAS
// ============================================
export const fullNameSchema = z
  .string()
  .trim()
  .min(2, "Full name must be at least 2 characters")
  .max(120, "Full name must be at most 120 characters")
  .optional()
  .or(z.literal(''))
  .transform(val => val?.trim() || null);

export const inviteUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  full_name: fullNameSchema,
  role: roleEnum,
  organization_id: z.string().uuid('Invalid organization ID').nullable().optional(),
}).superRefine((val, ctx) => {
  if ((val.role === 'member' || val.role === 'organization_admin') && !val.organization_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['organization_id'],
      message: 'Organization is required for this role',
    });
  }
});

export const changeRoleSchema = z.object({
  role: roleEnum.refine(role => role !== 'super_admin', {
    message: 'Cannot assign super_admin role',
  }),
});

export const assignOrganizationSchema = z.object({
  organization_id: z.string().uuid('Invalid organization ID'),
});

// ============================================
// ORGANIZATION SCHEMAS
// ============================================
export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Organization name must be at least 2 characters").max(100),
  slug: z.string().trim().min(2).max(60).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with dashes").optional(),
});

// ============================================
// SETTINGS SCHEMAS
// ============================================
export const themeSchema = z.record(z.string(), z.string()).nullable();

export const updateSettingsSchema = z.object({
  app_name: z.string().trim().max(100).optional(),
  logo_url: z.string().url().or(z.literal('')).optional(),
  top_logo_url: z.string().url().or(z.literal('')).optional(),
  top_logo_compact_url: z.string().url().or(z.literal('')).optional(),
  default_language: z.string().min(2).max(10).optional(),
  timezone: z.string().min(1).max(50).optional(),
  theme: themeSchema.optional(),
}).refine(data => {
  // At least one branding field must be present
  if (
    'app_name' in data &&
    'logo_url' in data &&
    'top_logo_url' in data &&
    'top_logo_compact_url' in data
  ) {
    const hasAppName = data.app_name && data.app_name.trim().length > 0;
    const hasLogo = data.logo_url && data.logo_url.trim().length > 0;
    const hasTopLogo = data.top_logo_url && data.top_logo_url.trim().length > 0;
    const hasTopCompactLogo = data.top_logo_compact_url && data.top_logo_compact_url.trim().length > 0;
    return hasAppName || hasLogo || hasTopLogo || hasTopCompactLogo;
  }
  return true;
}, {
  message: 'At least one branding field must be provided',
});

// ============================================
// PROFILE SCHEMAS
// ============================================
export const updateProfileSchema = z.object({
  full_name: fullNameSchema,
});

// ============================================
// COURSES SCHEMAS
// ============================================

export const courseVisibilityEnum = z.enum(['all', 'organizations']);
export type CourseVisibilityScope = z.infer<typeof courseVisibilityEnum>;

export const courseTitleSchema = z
  .string()
  .trim()
  .min(2, "Title must be at least 2 characters")
  .max(160, "Title must be at most 160 characters");

export const courseExcerptSchema = z
  .string()
  .trim()
  .max(280, "Excerpt must be at most 280 characters")
  .optional()
  .or(z.literal(''))
  .transform(val => val?.trim() || null);

export const courseDescriptionSchema = z
  .string()
  .trim()
  .max(5000, "Description must be at most 5000 characters")
  .optional()
  .or(z.literal(''))
  .transform(val => val?.trim() || null);

export const createCourseSchema = z.object({
  title: courseTitleSchema,
  excerpt: courseExcerptSchema,
  description: courseDescriptionSchema,
  visibility_scope: courseVisibilityEnum.default('organizations'),
  organization_ids: z.array(z.string().uuid('Invalid organization ID')).optional(),
});

export const updateCourseSchema = z.object({
  title: courseTitleSchema.optional(),
  excerpt: courseExcerptSchema.optional(),
  description: courseDescriptionSchema.optional(),
  is_published: z.boolean().optional(),
  visibility_scope: courseVisibilityEnum.optional(),
  organization_ids: z.array(z.string().uuid('Invalid organization ID')).optional(),
});

export const courseDifficultySchema = z.enum(["all_levels", "beginner", "intermediate", "expert"]);
export const courseStatusSchema = z.enum(["draft", "published"]);
export const introVideoProviderSchema = z.enum(["html5", "youtube", "vimeo"]);
export const courseItemTypeSchema = z.enum(["lesson", "quiz"]);
export const accessDurationKeySchema = z.enum(["unlimited", "3m", "1m", "1w"]);

export const createCourseV2Schema = z.object({
  title: courseTitleSchema,
});

export const patchCourseV2Schema = z.object({
  title: courseTitleSchema.optional(),
  slug: z
    .string()
    .trim()
    .min(2, "Slug must be at least 2 characters")
    .max(120, "Slug must be at most 120 characters")
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with dashes")
    .optional(),
  about_html: z.string().max(120000, "About course content is too long").optional().or(z.literal("")),
  excerpt: z.string().trim().max(200, "Excerpt must be at most 200 characters").optional().or(z.literal("")),
  difficulty_level: courseDifficultySchema.optional(),
  what_will_learn: z.string().max(12000, "What will I learn is too long").optional().or(z.literal("")),
  total_duration_hours: z.number().int().min(0).max(999).optional(),
  total_duration_minutes: z.number().int().min(0).max(59).optional(),
  materials_included: z.string().max(12000, "Materials included is too long").optional().or(z.literal("")),
  requirements_instructions: z.string().max(12000, "Requirements/Instructions is too long").optional().or(z.literal("")),
  intro_video_provider: introVideoProviderSchema.nullable().optional(),
  intro_video_url: z.string().trim().url("Invalid intro video URL").nullable().optional().or(z.literal("")),
});

export const setCourseMembersSchema = z.object({
  member_ids: z.array(z.string().uuid("Invalid member ID")).max(500, "Too many members selected"),
  default_access: accessDurationKeySchema.optional(),
  member_access: z.record(z.string().uuid("Invalid member ID"), accessDurationKeySchema).optional(),
});

export const createTopicSchema = z.object({
  title: z.string().trim().min(2, "Topic name must be at least 2 characters").max(160, "Topic name is too long"),
  summary: z.string().trim().max(2000, "Topic summary is too long").optional().or(z.literal("")),
});

export const updateTopicSchema = z.object({
  title: z.string().trim().min(2, "Topic name must be at least 2 characters").max(160, "Topic name is too long").optional(),
  summary: z.string().trim().max(2000, "Topic summary is too long").optional().or(z.literal("")),
});

export const reorderTopicsSchema = z.object({
  ordered_topic_ids: z.array(z.string().uuid("Invalid topic ID")).min(1, "No topics to reorder"),
});

export const createTopicItemSchema = z.object({
  item_type: courseItemTypeSchema,
  title: z.string().trim().max(160, "Title is too long").optional().or(z.literal("")),
  payload_json: z.record(z.string(), z.unknown()).optional(),
});

export const updateTopicItemSchema = z.object({
  title: z.string().trim().max(160, "Title is too long").optional().or(z.literal("")),
  payload_json: z.record(z.string(), z.unknown()).optional(),
  is_required: z.boolean().optional(),
});

// ============================================
// API RESPONSE HELPER
// ============================================
export type ZodValidationResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string };

export function validateSchema<T>(schema: z.ZodSchema<T>, data: unknown): ZodValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  // zod v4 uses .issues instead of .errors
  const firstIssue = result.error.issues[0];
  return { 
    success: false, 
    error: firstIssue?.message || 'Validation failed' 
  };
}