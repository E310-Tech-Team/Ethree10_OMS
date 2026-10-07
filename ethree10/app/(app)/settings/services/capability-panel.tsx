"use client";

import { useState } from "react";
// Type-only: erased at build, so the client bundle never pulls Prisma runtime.
import type { SkillLevel } from "@prisma/client";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { UserPlus, X, Sparkles } from "lucide-react";

const LEVEL_LABEL: Record<SkillLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  expert: "Expert",
};

const LEVEL_VARIANT: Record<SkillLevel, "default" | "secondary" | "outline"> = {
  expert: "default",
  advanced: "default",
  intermediate: "secondary",
  beginner: "outline",
};

/**
 * Who can deliver this service.
 *
 * Sits on the service rather than on a person: the question a lead actually asks
 * is "who can do this work", not "what can this person do". The reverse view is
 * available per member on the People screen.
 */
export function CapabilityPanel({ serviceId }: { serviceId: string }) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [pendingUserId, setPendingUserId] = useState("");
  const [pendingLevel, setPendingLevel] = useState<SkillLevel>("intermediate");

  const capable = trpc.services.capableOf.useQuery({ serviceId });
  // Everyone on staff. Suggestions only surface people whose recorded skills
  // happen to match the service name, which is empty for most services until
  // the skills taxonomy is well populated — without a direct picker there would
  // be no way to record capability at all on a fresh install.
  const members = trpc.members.list.useQuery();
  const suggestions = trpc.services.capabilitySuggestions.useQuery(
    { serviceId },
    { enabled: showSuggestions },
  );

  const invalidate = () => {
    void utils.services.capableOf.invalidate({ serviceId });
    void utils.services.capabilitySuggestions.invalidate({ serviceId });
    void utils.services.capabilityMatrix.invalidate();
  };

  const grant = trpc.services.grantCapability.useMutation({
    onSuccess: () => {
      invalidate();
      toast({ title: "Capability recorded" });
    },
    onError: (error) =>
      toast({ title: "Could not record it", description: error.message, variant: "destructive" }),
  });

  const revoke = trpc.services.revokeCapability.useMutation({
    onSuccess: () => {
      invalidate();
      toast({ title: "Capability withdrawn" });
    },
    onError: (error) =>
      toast({ title: "Could not withdraw it", description: error.message, variant: "destructive" }),
  });

  const people = capable.data ?? [];

  return (
    <div className="space-y-3 border-t border-border/60 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Who can deliver this
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowSuggestions((open) => !open)}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {showSuggestions ? "Hide suggestions" : "Suggest from skills"}
        </Button>
      </div>

      {capable.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : people.length === 0 ? (
        // Deliberately worded as a staffing fact rather than an error. A service
        // nobody can deliver is worth noticing before a request for it arrives.
        <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Nobody is recorded as able to deliver this yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {people.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{entry.user.name}</span>
              <Badge variant={LEVEL_VARIANT[entry.level]}>{LEVEL_LABEL[entry.level]}</Badge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto h-7 px-2"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate({ userId: entry.user.id, serviceId })}
              >
                <X className="h-3.5 w-3.5" />
                <span className="sr-only">Withdraw {entry.user.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <Select value={pendingUserId} onValueChange={setPendingUserId}>
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Add someone…" />
            </SelectTrigger>
            <SelectContent>
              {(members.data ?? [])
                .filter((m: { user: { id: string } }) => !people.some((p) => p.user.id === m.user.id))
                .map((m: { user: { id: string; name: string } }) => (
                  <SelectItem key={m.user.id} value={m.user.id}>
                    {m.user.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <Select value={pendingLevel} onValueChange={(level) => setPendingLevel(level as SkillLevel)}>
          <SelectTrigger className="h-8 w-38">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(LEVEL_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={!pendingUserId || grant.isPending}
          onClick={() => {
            grant.mutate({ userId: pendingUserId, serviceId, level: pendingLevel });
            setPendingUserId("");
          }}
        >
          <UserPlus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      {showSuggestions && (
        <div className="rounded-md bg-muted/50 p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Based on skills already recorded. Nothing is added until you confirm it.
          </p>
          {suggestions.isLoading ? (
            <p className="text-sm text-muted-foreground">Looking…</p>
          ) : (suggestions.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No one&apos;s recorded skills match this service.
            </p>
          ) : (
            <ul className="space-y-2">
              {(suggestions.data ?? []).map((suggestion) => (
                <li key={suggestion.userId} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{suggestion.name}</span>
                  <span className="min-w-0 text-xs text-muted-foreground">
                    {suggestion.matchedSkills.join(", ")}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <Select
                      defaultValue={suggestion.suggestedLevel}
                      onValueChange={(level) =>
                        grant.mutate({
                          userId: suggestion.userId,
                          serviceId,
                          level: level as SkillLevel,
                        })
                      }
                    >
                      <SelectTrigger className="h-8 w-38">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(LEVEL_LABEL).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8"
                      disabled={grant.isPending}
                      onClick={() =>
                        grant.mutate({
                          userId: suggestion.userId,
                          serviceId,
                          level: suggestion.suggestedLevel,
                        })
                      }
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Add
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
