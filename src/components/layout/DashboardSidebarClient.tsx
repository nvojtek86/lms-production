'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Loader2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV_ICONS, type NavItem } from "@/config/navigation";
import { ROLE_PRIMARY_CACHE_KEY } from "@/lib/theme/themeConstants";
import { useEffect, useRef, useState } from "react";
import AppBranding from "@/components/ui/AppBranding";

type DashboardSidebarClientProps = {
  menuItems: NavItem[];
  canLogout: boolean;
};

export function DashboardSidebarClient({ menuItems, canLogout }: DashboardSidebarClientProps) {
  const pathname = usePathname();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const userToggledCollapsedRef = useRef(false);

  const isLearnRoute = (() => {
    if (!pathname) return false;
    return /^\/org\/[^/]+\/courses\/[^/]+\/learn(?:\/|$)/.test(pathname);
  })();

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1024px)");
    let frameId: number | null = null;

    if (!isLearnRoute && !userToggledCollapsedRef.current) {
      frameId = window.requestAnimationFrame(() => {
        setCollapsed(mq.matches);
      });
    }

    const onChange = (e: MediaQueryListEvent) => {
      if (isLearnRoute) return;
      if (userToggledCollapsedRef.current) return;
      setCollapsed(e.matches);
    };

    mq.addEventListener("change", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [isLearnRoute]);

  useEffect(() => {
    userToggledCollapsedRef.current = false;
    const mq = window.matchMedia("(max-width: 1024px)");
    const nextCollapsed = isLearnRoute ? true : mq.matches;
    const frameId = window.requestAnimationFrame(() => {
      setCollapsed(nextCollapsed);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isLearnRoute]);

  const isDashboardRoute =
    pathname.startsWith("/admin") || pathname.startsWith("/system") || pathname.startsWith("/org");

  const activeHref = (() => {
    if (!pathname || menuItems.length === 0) return null;

    const candidates = menuItems
      .map((item) => item.href)
      .filter((href) => {
        if (href === pathname) return true;
        return pathname.startsWith(href + "/");
      });

    if (candidates.length === 0) return null;
    return candidates.reduce((best, cur) => (cur.length > best.length ? cur : best), candidates[0]);
  })();

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      try {
        localStorage.removeItem(ROLE_PRIMARY_CACHE_KEY);
      } catch {
        // ignore
      }
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.assign("/");
    } catch (err) {
      console.error("Logout error:", err);
      setIsLoggingOut(false);
    }
  };

  return (
    <aside
      className={`flex h-full min-h-0 shrink-0 flex-col bg-primary text-white transition-all duration-200 ease-in-out ${
        collapsed ? "w-[78px]" : "w-[280px]"
      }`}
    >
      <div className={`border-b border-white/10 ${collapsed ? "px-2 py-4" : "px-4 py-5"}`}>
        <div className="flex items-center justify-center">
          {collapsed ? (
            <AppBranding variant="top-compact" width={38} height={38} />
          ) : (
            <AppBranding variant="top" width={176} height={56} />
          )}
        </div>
      </div>

      {isDashboardRoute && menuItems.length > 0 ? (
        <nav
          className={`
            flex-1 min-h-0 overflow-y-auto space-y-1
            ${collapsed ? "px-2" : "px-4"}
            pt-4 pb-4
          `}
        >
          <div>
            <button
              type="button"
              onClick={() => {
                userToggledCollapsedRef.current = true;
                setCollapsed((v) => !v);
              }}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={`
                w-full flex items-center rounded-md transition-colors
                ${collapsed ? "justify-center px-0 py-3" : "gap-3 px-3 py-2.5"}
                text-white/80 hover:text-white cursor-pointer
              `}
            >
              {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
              {collapsed ? (
                <span className="sr-only">{collapsed ? "Expand" : "Collapse"}</span>
              ) : (
                <span className="truncate">{collapsed ? "Expand" : "Collapse"}</span>
              )}
            </button>
          </div>

          {/* <div className="my-2 border-t border-white/10" /> */}

          {menuItems.map((item) => {
            const Icon = NAV_ICONS[item.iconKey] ?? NAV_ICONS.LayoutDashboard;
            const isActive = activeHref === item.href;

            return (
              <Link
                key={item.label}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`
                  flex items-center transition-colors
                  ${collapsed ? "justify-center rounded-md px-0 py-3" : "gap-3 rounded-md px-3 py-2.5"}
                  ${
                    isActive
                      ? "bg-white text-primary hover:text-primary hover:bg-white font-medium"
                      : "text-white/80 hover:bg-white/10 hover:text-white"
                  }
                `}
              >
                <Icon size={20} />
                {collapsed ? (
                  <span className="sr-only">{item.label}</span>
                ) : (
                  <span className="truncate">{item.label}</span>
                )}
              </Link>
            );
          })}

          {canLogout ? (
            <button
              title={collapsed ? "Logout" : undefined}
              className={`
                mt-5 flex w-full items-center rounded-md transition-colors text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-50 cursor-pointer
                ${collapsed ? "justify-center px-0 py-3" : "gap-3 px-3 py-2.5"}
              `}
              onClick={handleLogout}
              disabled={isLoggingOut}
            >
              {isLoggingOut ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <LogOut size={20} />
              )}
              {collapsed ? (
                <span className="sr-only">{isLoggingOut ? "Logging out..." : "Logout"}</span>
              ) : (
                <span>{isLoggingOut ? "Logging out..." : "Logout"}</span>
              )}
            </button>
          ) : null}
        </nav>
      ) : (
        <div className="flex-1" />
      )}

      <div
        className={`mt-auto border-t border-white/10 px-3 py-3 text-white/70 ${
          collapsed ? "text-[10px] text-center" : "text-xs text-center leading-relaxed"
        }`}
      >
        © 2026 Smart Consulting Agency. All rights reserved.
      </div>
    </aside>
  );
}
