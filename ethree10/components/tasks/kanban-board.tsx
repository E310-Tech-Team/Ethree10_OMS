"use client";

import Link from "next/link";
import type { TaskStatus } from "@prisma/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { UrgencyTag } from "@/components/ui-ext/urgency-tag";
import { formatDate, initials } from "@/lib/format";
import { humanize } from "@/lib/constants";

interface KanbanTask {
  id: string;
  code: string;
  title: string;
  status: TaskStatus;
  priority: string;
  dueDate: Date | string | null;
  subUnit: { id: string; name: string } | null;
  assignee?: { id: string; name: string } | null;
}

const COLUMNS: TaskStatus[] = ["todo", "in_progress", "blocked", "in_review", "done"];

export function KanbanBoard({ tasks }: { tasks: KanbanTask[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
      {COLUMNS.map((col) => {
        const items = tasks.filter((t) => t.status === col);
        return (
          <div key={col} className="flex flex-col rounded-lg bg-muted/40 p-3">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">{humanize(col)}</span>
              <span className="rounded-full bg-background px-2 text-xs text-muted-foreground">
                {items.length}
              </span>
            </div>
            <div className="space-y-2">
              {items.map((task) => (
                <Link
                  key={task.id}
                  href={`/tasks/${task.id}`}
                  className="block rounded-md border bg-card p-3 shadow-xs transition-colors hover:border-brand-300"
                >
                  <p className="text-sm font-medium leading-snug">{task.title}</p>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">{task.code}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <UrgencyTag value={task.priority} />
                    {task.assignee && (
                      <Avatar className="h-6 w-6">
                        <AvatarFallback className="text-[10px]">
                          {initials(task.assignee.name)}
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                  {task.dueDate && (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Due {formatDate(task.dueDate)}
                    </p>
                  )}
                </Link>
              ))}
              {items.length === 0 && (
                <p className="px-1 py-4 text-center text-xs text-muted-foreground">—</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
