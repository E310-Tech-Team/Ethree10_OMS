"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { SidebarContent } from "@/components/layout/app-sidebar";

/**
 * Mobile/tablet navigation — a hamburger button that opens the sidebar as a
 * left slide-in drawer. Hidden at `lg` and up, where the static rail is shown.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the route changes (after tapping a nav item).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label="Open navigation menu"
        className="inline-flex h-11 w-11 lg:h-9 lg:w-9 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
      >
        <Menu className="h-5 w-5" strokeWidth={1.75} />
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-sm animate-in fade-in-0 lg:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar text-sidebar-foreground shadow-pop focus:outline-none animate-in slide-in-from-left-full lg:hidden"
        >
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <Dialog.Close
            aria-label="Close navigation menu"
            className="absolute right-3 top-4 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <X className="h-5 w-5" />
          </Dialog.Close>
          <SidebarContent />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
