"use client";

import { signOut } from "next-auth/react";
import { LogOut, User as UserIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/format";

export function AccountMenu({
  name,
  email,
  image,
}: {
  name: string | null;
  email: string | null;
  image: string | null;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex min-h-[44px] items-center gap-2 rounded-md p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-0 lg:p-1">
        {/* Keyed on the image: Radix keeps its "loaded" status when AvatarImage
            unmounts, so removing a photo would otherwise leave a blank circle
            with no initials until the next full page load. */}
        <Avatar key={image ?? "none"} className="h-8 w-8">
          {image ? <AvatarImage src={image} alt={name ?? "User"} /> : null}
          <AvatarFallback>{initials(name ?? email)}</AvatarFallback>
        </Avatar>
        <span className="hidden text-sm font-medium sm:inline">{name ?? email}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate">{name ?? "Account"}</span>
          {email && (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {email}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/settings">
            <UserIcon className="h-4 w-4" />
            Settings
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut({ callbackUrl: "/login" })}>
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
