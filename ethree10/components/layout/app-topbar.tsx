import { AccountMenu } from "@/components/layout/account-menu";
import { NotificationBell } from "@/components/layout/notification-bell";
import { MobileNav } from "@/components/layout/mobile-nav";
import { GlobalSearch } from "@/components/layout/global-search";

interface AppTopbarProps {
  /**
   * Read from the database by the layout, not from the session. The JWT is
   * stamped at sign-in and never refreshed, so `session.user.image` kept
   * showing the old avatar after a profile save until the user logged out.
   */
  user: { name: string | null; email: string | null; image: string | null };
}

export function AppTopbar({ user }: AppTopbarProps) {
  // min-h rather than h, so the notch inset adds to the bar instead of eating
  // into its 4rem of content.
  return (
    <header className="sticky top-0 z-30 flex min-h-[4rem] items-center justify-between gap-4 border-b border-border bg-glass-header px-4 pt-safe backdrop-blur-md backdrop-saturate-150 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <MobileNav />

        <GlobalSearch />
      </div>

      <div className="flex items-center gap-1.5">
        <NotificationBell />
        <AccountMenu
          name={user.name ?? null}
          email={user.email ?? null}
          image={user.image ?? null}
        />
      </div>
    </header>
  );
}
