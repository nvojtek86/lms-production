'use client';

import { useState } from 'react';
import { ShieldX } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { ROLE_PRIMARY_CACHE_KEY } from '@/lib/theme/themeConstants';

export default function UnauthorizedPage() {
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Landing here usually means the session is valid but cannot reach any dashboard,
  // so '/' would bounce straight back. Clearing the session is what makes login reachable.
  const handleBackToLogin = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);

    try {
      localStorage.removeItem(ROLE_PRIMARY_CACHE_KEY);
    } catch {
      // ignore
    }

    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }

    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }

    // Hard redirect so proxy.ts re-evaluates cookies immediately
    window.location.assign('/');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-6 p-8">
        <div className="flex justify-center">
          <ShieldX className="h-24 w-24 text-destructive" />
        </div>
        
        <h1 className="text-4xl font-bold text-foreground">
          Access Denied
        </h1>
        
        <p className="text-lg text-muted-foreground max-w-md">
          You don&apos;t have permission to access this page. 
          Please contact your administrator if you believe this is an error.
        </p>
        
        <div className="flex gap-4 justify-center">
          <Button onClick={handleBackToLogin} disabled={isLoggingOut}>
            {isLoggingOut ? 'Signing out...' : 'Log out and go to Login'}
          </Button>
        </div>
      </div>
    </div>
  );
}
