import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

// Define valid user roles
type UserRole = 'super_admin' | 'system_admin' | 'organization_admin' | 'member';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Routes that don't require authentication (but '/' needs special handling)
const PUBLIC_ROUTES = ['/login', '/forgot-password', '/reset-password', '/support', '/company', '/legal', '/unauthorized'];

// Route access configuration by role
const ROUTE_ACCESS: Record<string, UserRole[]> = {
  '/admin': ['super_admin'],
  '/system': ['super_admin', 'system_admin'],
  '/org': ['super_admin', 'system_admin', 'organization_admin', 'member'],
};

// Note: We use process.env directly here because proxy.ts runs in Edge runtime
// and env.mjs validation happens at build time for these public variables.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function getOrgRedirectTarget(
  supabase: SupabaseClient,
  userId: string,
  role: UserRole,
  primaryOrganizationId: string | null
): Promise<{ organizationId: string; slug: string | null } | null> {
  let organizationId = primaryOrganizationId;

  if (!organizationId && (role === 'organization_admin' || role === 'member')) {
    const { data: membership } = await supabase
      .from('organization_memberships')
      .select('organization_id')
      .eq('user_id', userId)
      .eq('role', role)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const membershipOrgId = (membership as { organization_id?: unknown } | null)?.organization_id;
    organizationId = typeof membershipOrgId === 'string' && membershipOrgId.trim().length > 0 ? membershipOrgId : null;
  }

  if (!organizationId) return null;

  const { data: orgRow } = await supabase
    .from('organizations')
    .select('slug')
    .eq('id', organizationId)
    .maybeSingle();
  const slugRaw = (orgRow as { slug?: unknown } | null)?.slug;
  const slug = typeof slugRaw === 'string' && slugRaw.trim().length > 0 ? slugRaw.trim() : null;

  return { organizationId, slug };
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  
  // Allow static assets and Next.js internals
  if (path.startsWith('/_next') || path.startsWith('/api') || path.match(/\.(ico|png|jpg|jpeg|svg|css|js|woff|woff2)$/)) {
    return NextResponse.next();
  }

  // Invite-only: registration is disabled. Redirect /register to login landing.
  if (path === '/register') {
    const url = new URL('/', request.url);
    url.searchParams.set('notice', 'invite-only');
    return NextResponse.redirect(url);
  }

  // Allow public routes (except '/' which needs special handling)
  if (PUBLIC_ROUTES.some(route => path === route)) {
    return NextResponse.next();
  }

  // Create Supabase client for middleware
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Get user session
  const { data: { user }, error } = await supabase.auth.getUser();

  // CASE 1: No user logged in
  if (!user || error) {
    // If we have a broken/partial session cookie (common after switching auth storage),
    // clear Supabase cookies and treat as logged out.
    if (error?.message?.toLowerCase().includes('refresh token')) {
      const redirect = NextResponse.redirect(new URL('/', request.url));
      for (const c of request.cookies.getAll()) {
        // Supabase auth cookies typically start with "sb-"
        if (c.name.startsWith('sb-')) {
          redirect.cookies.set(c.name, '', { path: '/', maxAge: 0 });
        }
      }
      return redirect;
    }

    // Allow access to login page
    if (path === '/') {
      return response;
    }
    // Redirect to login for protected routes
    if (path.startsWith('/admin') || path.startsWith('/system') || path.startsWith('/org')) {
      const loginUrl = new URL('/', request.url);
      loginUrl.searchParams.set('redirect', path);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  // CASE 2: User is logged in - fetch role + active flag from database
  const { data: dbUser, error: roleError } = await supabase
    .from('users')
    .select('role, organization_id, is_active')
    .eq('id', user.id)
    .single();

  if (roleError || !dbUser?.role) {
    console.warn('User has no role in DB:', user.email, roleError?.message);
    // Treat "no DB role" as not provisioned / not allowed into the app.
    // Important UX rule:
    // - If a user is NOT properly logged into the LMS (no DB role), send them to "/" (login),
    //   not to "/unauthorized". Also clear any broken auth cookies so we don't get stuck.
    const redirect = NextResponse.redirect(new URL('/', request.url));
    for (const c of request.cookies.getAll()) {
      if (c.name.startsWith('sb-')) {
        redirect.cookies.set(c.name, '', { path: '/', maxAge: 0 });
      }
    }
    return redirect;
  }

  const userRole = dbUser.role as UserRole;
  const organizationId = dbUser.organization_id as string | null;
  const isActive = (dbUser as { is_active?: boolean | null }).is_active !== false;

  // Disabled users are not allowed to access any protected area.
  if (!isActive) {
    const redirect = NextResponse.redirect(new URL('/?notice=disabled', request.url));
    for (const c of request.cookies.getAll()) {
      if (c.name.startsWith('sb-')) {
        redirect.cookies.set(c.name, '', { path: '/', maxAge: 0 });
      }
    }
    return redirect;
  }

  // CASE 3: Logged-in user on login page → redirect to their dashboard
  if (path === '/') {
    const url = new URL(request.url);

    if (userRole === 'organization_admin' || userRole === 'member') {
      const orgTarget = await getOrgRedirectTarget(supabase, user.id, userRole, organizationId);
      if (!orgTarget) {
        // Must not target '/': this branch already runs on '/' and would redirect forever.
        url.pathname = '/unauthorized';
        return NextResponse.redirect(url);
      }
      url.pathname = `/org/${orgTarget.slug ?? orgTarget.organizationId}`;
      return NextResponse.redirect(url);
    }

    const redirectUrl = getRedirectUrlForRole(userRole, organizationId, request.url);
    return NextResponse.redirect(redirectUrl);
  }

  // Convenience: /org → redirect to canonical org dashboard
  if (path === '/org' || path === '/org/') {
    const url = new URL(request.url);
    if (userRole === 'super_admin') {
      url.pathname = '/admin';
      return NextResponse.redirect(url);
    }
    if (userRole === 'system_admin') {
      url.pathname = '/system';
      return NextResponse.redirect(url);
    }
    if (userRole === 'organization_admin' || userRole === 'member') {
      const orgTarget = await getOrgRedirectTarget(supabase, user.id, userRole, organizationId);
      if (!orgTarget) {
        url.pathname = '/unauthorized';
        return NextResponse.redirect(url);
      }
      url.pathname = `/org/${orgTarget.slug ?? orgTarget.organizationId}`;
      return NextResponse.redirect(url);
    }
  }

  // Canonicalize org URLs:
  // - /org/<uuid>/... → /org/<slug>/...
  // - /org/<SLUG>/... → /org/<slug>/... (lowercase canonical)
  if (path.startsWith('/org/')) {
    const parts = path.split('/').filter(Boolean); // ["org", orgKey, ...rest]
    const orgKey = parts[1] ?? '';
    if (orgKey) {
      const url = new URL(request.url);
      if (UUID_RE.test(orgKey)) {
        const { data: orgRow } = await supabase
          .from('organizations')
          .select('slug')
          .eq('id', orgKey)
          .maybeSingle();
        const slugRaw = (orgRow as { slug?: unknown } | null)?.slug;
        const slug = typeof slugRaw === 'string' && slugRaw.trim().length > 0 ? slugRaw.trim() : null;
        if (slug && slug !== orgKey) {
          const rest = parts.length > 2 ? '/' + parts.slice(2).join('/') : '';
          url.pathname = `/org/${slug}${rest}`;
          return NextResponse.redirect(url);
        }
      } else {
        const lower = orgKey.toLowerCase();
        if (lower !== orgKey) {
          const rest = parts.length > 2 ? '/' + parts.slice(2).join('/') : '';
          url.pathname = `/org/${lower}${rest}`;
          return NextResponse.redirect(url);
        }
      }
    }
  }

  // CASE 4: Enforce role-based access on protected routes
  for (const [routePrefix, allowedRoles] of Object.entries(ROUTE_ACCESS)) {
    if (path.startsWith(routePrefix)) {
      if (!allowedRoles.includes(userRole)) {
        console.warn(`ACCESS DENIED: ${user.email} (${userRole}) → ${path}`);
        // Wrong role → redirect to /unauthorized (not their dashboard)
        return NextResponse.redirect(new URL('/unauthorized', request.url));
      }
      break;
    }
  }

  return response;
}

// Role-based redirect handler
function getRedirectUrlForRole(
  role: UserRole,
  organizationId: string | null,
  baseUrl: string
): URL {
  const url = new URL(baseUrl);

  switch (role) {
    case 'super_admin':
      url.pathname = '/admin';
      break;
    case 'system_admin':
      url.pathname = '/system';
      break;
    case 'organization_admin':
    case 'member':
      url.pathname = organizationId ? `/org/${organizationId}` : '/';
      break;
    default:
      url.pathname = '/';
  }

  return url;
}

// Matcher configuration
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|branding|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
