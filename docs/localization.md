# English and Serbian Latin

Run `npm run dev` and open http://localhost:3000. The ignored `.env.local` points to the separate dev Supabase project. Never commit its contents.

The public pages and dashboard header offer English and Srpski (latinica). The app preference is saved in an HTTP-only browser cookie for one year. Learner course pages have a separate selector: an explicit per-course override wins over the course default; **Use course default** removes that override. A course override does not change the dashboard or another course. Preferences are browser-local, not synced across devices. Existing courses default to English. Course content, question text, answers, uploaded documents, and generated certificate templates remain authored content.

## Database review

The versioned change is in `supabase/migrations/20261007120000_course_default_language.sql`. It was applied manually to the separate dev database on 2026-10-07 and verified locally by the user. Staging/production application has not been authorized. The migration uses `IF NOT EXISTS` so the dev column is not added twice. It adds only `courses.default_language`, required, default `'en'`, restricted to `'en'` and `'sr-Latn'`. It changes no RLS policies or permissions.

Review the SQL before running it against the dev database. Until applied, the app falls back to English course defaults and disables the default-language selector with an explanatory message. Global language selection and learner course overrides remain usable. After applying, refresh the app, edit a course's General settings, set its default interface language, and save.

## Local verification

- `npm run test:i18n` checks catalog parity, interpolation, explicit message coverage, locale input validation, independent cookies, authored option labels, course-default precedence, and missing-column fallback.
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`

Sign in with each dev role and switch languages. Check learner lists, course overview, lessons, quiz questions/results, certificate lists, profile, organization course/quiz builder, users, settings, reports, and system admin screens. After the dev migration, use two courses with different defaults; verify English and Serbian overrides survive refresh and that resetting one course leaves the other unchanged. Authenticated screens and database persistence require dev accounts and the migration for an end-to-end walkthrough.

## Adding interface messages

Use `useUi()` in client or synchronous components and `await getUi()` in async server components. Pass literal English interface text to `ui`, with named placeholders and a values object for dynamic text. Add matching entries to both `src/messages/en.json` and `src/messages/sr-Latn.json`; the keys must match and can be any unique stable string. The English value is the lookup text. Do not translate database identifiers, enum values, CSS, URLs, organization names, course titles, or other authored text. `ui.optionLabel(label, value)` preserves UUID-valued authored choices. Run `npm run test:i18n` after adding messages.

## Staging release

The current site at https://lms-sca2025.vercel.app uses the production Supabase project (`laegnwszsrzzeippjljd`), while local development uses the separate dev project (`svwvyouahkoorylzaajt`). Resolve that separation before testing writes on a hosted staging deployment.

1. In the Vercel project connected to `nvojtek86/lms-staging`, verify Settings → Git and the branch tracked for the staging URL. Feature branches normally create Preview deployments; the configured production branch controls the project's main domain. A project called staging can still use Vercel's Production environment.
2. Set the environment variables for the actual staging deployment environment: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY` from the dev project. Set `NEXT_PUBLIC_APP_URL` to the staging HTTPS URL. Keep localhost values local. Do not paste secrets into Git or PRs.
3. Configure dev Supabase Auth's allowed redirect URLs for that staging origin and `/reset-password`; verify invite and recovery links on staging.
4. Deploy the feature branch as a Preview with dev credentials and test all roles, course defaults, overrides, invitations, and recovery. Environment-variable changes require a new deployment. The course-language migration already exists on the current dev database; a different staging database needs this exact migration applied explicitly. Do not blindly apply historical migrations.
5. Once the Preview is verified, merge the PR into the branch actually tracked for the staging domain. Verify the deployed commit, database project, and tests again. Release to the real production app/database remains a separate decision.

Deployment permissions and Vercel settings are external to this repo. No staging environment variables, production data, or deployment settings were changed as part of the Git push. Roll back application code to the previous deployment if needed; the additive English-default column can remain.

References: [Vercel environments](https://vercel.com/docs/deployments/environments), [Vercel environment variables](https://vercel.com/docs/environment-variables).
