import type { Metadata } from "next";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { db } from "@/server/db/client";

export const metadata: Metadata = {
  title: "Ethree10 — Creative & Technology Agency",
  description:
    "Ethree10 turns project requests into structured, tracked, delivered work for Reach4Christ Global and selected partners.",
};

const SERVICES = [
  { title: "Web & Product", body: "Marketing sites, web apps, and internal tools." },
  { title: "Mobile", body: "Cross-platform apps that work on mid-range devices." },
  { title: "Brand & Creative", body: "Identity, design systems, and campaign assets." },
  { title: "Strategy & Ops", body: "Systems and processes that help teams scale." },
];

export default async function MarketingHomePage() {
  const cmsContent = await db.marketingContent.findMany({
    where: { key: { in: ["home_hero", "home_services"] } }
  });

  const getCms = (key: string, fallback: string) => {
    const content = cmsContent.find(c => c.key === key)?.content;
    return content || fallback;
  };

  const heroFallback = `Ethree10 is the technology and product agency of Reach4Christ Global. We turn requests from sibling initiatives and partners into structured, tracked, delivered work.`;
  
  return (
    <main>
      <section className="px-6 py-24 text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          Creative & technology
          <br />
          <span className="text-brand-600">for Kingdom impact</span>
        </h1>
        <div className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground prose prose-lg dark:prose-invert">
          <ReactMarkdown>{getCms("home_hero", heroFallback)}</ReactMarkdown>
        </div>
        <div className="mt-10 flex justify-center gap-4">
          <Link
            href="/request"
            className="rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Start a project
          </Link>
          <Link href="/services" className="rounded-md border px-6 py-3 text-sm font-semibold hover:bg-muted">
            Explore services
          </Link>
        </div>
      </section>

      <section id="services" className="border-t bg-neutral-50 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-2xl font-semibold tracking-tight">What we do</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {SERVICES.map((s) => (
              <div key={s.title} className="rounded-lg border bg-card p-6 shadow-xs">
                <h3 className="text-base font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight">One way to request work</h2>
          <p className="mt-4 text-muted-foreground">
            No more lost WhatsApp threads. Submit a request, track it from scoping to delivery,
            and see exactly who is doing what.
          </p>
          <Link
            href="/request"
            className="mt-8 inline-block rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Submit a request
          </Link>
        </div>
      </section>
    </main>
  );
}
