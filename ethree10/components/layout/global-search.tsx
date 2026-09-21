"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, FileText, FolderKanban, CheckSquare, Users, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

const ICONS = {
  request: FileText,
  project: FolderKanban,
  task: CheckSquare,
  person: Users,
} as const;

const TYPE_LABEL = {
  request: "Request",
  project: "Project",
  task: "Task",
  person: "Person",
} as const;

/**
 * Global search, opened with ⌘K / Ctrl-K or the header button.
 *
 * The header previously rendered a search box with no handler at all — it looked
 * functional and did nothing, which is worse than having no search.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounce so typing does not fire a query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 200);
    return () => clearTimeout(timer);
  }, [term]);

  const { data: results = [], isFetching } = trpc.search.query.useQuery(
    { q: debounced },
    { enabled: open && debounced.length >= 2, staleTime: 15_000 },
  );

  // Guard against a stale index when a query returns fewer results.
  const selected = Math.min(active, Math.max(results.length - 1, 0));

  const go = (href: string) => {
    setOpen(false);
    setTerm("");
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        aria-label="Search"
        onClick={() => setOpen(true)}
        className="hidden h-9 w-64 items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted lg:flex"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      {/* Mobile: icon only, same dialog. */}
      <button
        type="button"
        aria-label="Search"
        onClick={() => setOpen(true)}
        className="flex h-11 w-11 lg:h-9 lg:w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted lg:hidden"
      >
        <Search className="h-4 w-4" aria-hidden />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[15%] max-w-xl translate-y-0 gap-0 p-0">
          <DialogTitle className="sr-only">Search requests, projects, tasks and people</DialogTitle>

          <div className="flex items-center gap-2 border-b px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <Input
              autoFocus
              value={term}
              onChange={(event) => {
                setTerm(event.target.value);
                // Reset the highlight here rather than in an effect — a new query
                // means the previous selection is meaningless.
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((i) => Math.min(i + 1, results.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                } else if (event.key === "Enter" && results[selected]) {
                  event.preventDefault();
                  go(results[selected].href);
                }
              }}
              placeholder="Search requests, projects, tasks and people…"
              className="border-0 shadow-none focus-visible:ring-0"
              aria-label="Search query"
              aria-controls="global-search-results"
            />
            {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
          </div>

          <div id="global-search-results" role="listbox" className="max-h-80 overflow-y-auto p-2">
            {debounced.length < 2 ? (
              <p className="p-4 text-sm text-muted-foreground">
                Type at least two characters. Searches codes, titles, clients and people.
              </p>
            ) : results.length === 0 && !isFetching ? (
              <p className="p-4 text-sm text-muted-foreground">
                Nothing matched &ldquo;{debounced}&rdquo;.
              </p>
            ) : (
              results.map((hit, index) => {
                const Icon = ICONS[hit.type];
                return (
                  <button
                    key={`${hit.type}-${hit.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === selected}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(hit.href)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors",
                      index === selected ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{hit.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{hit.subtitle}</span>
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {TYPE_LABEL[hit.type]}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
