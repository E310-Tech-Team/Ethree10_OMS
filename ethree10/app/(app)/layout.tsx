export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";

import { db } from "@/server/db/client";
import { InstallPrompt } from "@/components/layout/install-prompt";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const dbUser = await db.user.findUnique({
    where: { id: session.user.id },
    include: { memberships: true }
  });

  const hasStaffAccess = dbUser?.isSuperAdmin || dbUser?.memberships.some((membership) => !membership.removedAt && membership.acceptedAt);
  if (!hasStaffAccess) redirect("/unauthorized");

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Keyboard users land here first; without it, reaching page content means
          tabbing through the whole sidebar on every navigation. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      {/* Roles come from the session on the server, so the correct navigation is
          present on first paint rather than flashing in after an auth query. */}
      <AppSidebar
        roles={(dbUser?.memberships ?? [])
          .filter((membership) => !membership.removedAt && membership.acceptedAt)
          .map((membership) => membership.role)}
        isSuperAdmin={dbUser?.isSuperAdmin ?? false}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AppTopbar
          user={{
            name: dbUser?.name ?? session.user.name ?? null,
            email: dbUser?.email ?? session.user.email ?? null,
            image: dbUser?.avatarUrl ?? null,
          }}
        />
        <main
          id="main-content"
          tabIndex={-1}
          // No background: the body's ambient field has to reach the panes.
          // overscroll-contain: reaching the bottom of a long page used to chain the
          // scroll to the document, which then rubber-banded and exposed the
          // canvas beneath the shell. It only happened on pages long enough to
          // scroll, which is why it looked page-specific.
          className="flex-1 overflow-y-auto overscroll-contain p-4 pb-safe focus:outline-none md:p-6"
        >
          <div className="mx-auto max-w-[1440px]">{children}</div>
          <InstallPrompt />
        </main>
      </div>
    </div>
  );
}
