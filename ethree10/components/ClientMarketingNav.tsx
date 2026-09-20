"use client";

import Link from "next/link";
import { useTranslation } from "@/lib/hooks/use-translation";
import { LanguageSwitcher } from "./LanguageSwitcher";

const NAV = [
  { href: "/services", labelKey: "nav.services", fallback: "Services" },
  { href: "/about", labelKey: "nav.about", fallback: "About" },
  { href: "/contact", labelKey: "nav.contact", fallback: "Contact" },
];

export function ClientMarketingNav() {
  const { t } = useTranslation();

  return (
    <nav className="flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-2 sm:gap-x-6">
      {NAV.map((item) => {
        const label = t(item.labelKey);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {label === item.labelKey ? item.fallback : label}
          </Link>
        );
      })}
      
      <LanguageSwitcher />

      <Link
        href="/login"
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        {t("nav.login") === "nav.login" ? "Sign in" : t("nav.login")}
      </Link>
    </nav>
  );
}
