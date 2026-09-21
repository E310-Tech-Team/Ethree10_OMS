/**
 * The department structure, and who is actually in it.
 *
 * A task carries a department (`Task.subUnitId`), and the app matches work to
 * people through it. But membership in a department is a separate field on
 * `Membership`, and nothing forces the two to agree — so a task can sit in a
 * department that has no members, which is how TSK-2026-00001 came to be in
 * Product Design while nobody in the branch was.
 *
 * That is invisible from every screen: the task shows its department, the
 * person shows their branch, and neither says the department is empty.
 *
 *   pnpm departments
 *     Reports branches, their departments, members, and the mismatches.
 *
 *   pnpm departments --set-department user@x.org --to "Product Design"
 *     Dry run. Add --execute to write.
 *
 *   pnpm departments --set-department user@x.org --to none --execute
 *     Clears it.
 *
 *   pnpm departments --set-lead user@x.org --department "Product Design" --execute
 *     Makes them the department's lead. They must already be a member of it:
 *     a lead who is not in the department they lead is how three of these
 *     ended up leading a queue they cannot see in their own sidebar.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const EXECUTE = process.argv.includes("--execute");

async function report() {
  const branches = await db.team.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      name: true,
      subUnits: {
        where: { archivedAt: null },
        select: { id: true, name: true, leadId: true },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  console.log("BRANCHES AND DEPARTMENTS\n");

  for (const branch of branches) {
    const members = await db.membership.findMany({
      where: { teamId: branch.id, removedAt: null, acceptedAt: { not: null } },
      select: {
        role: true,
        subUnitId: true,
        user: { select: { email: true, deactivatedAt: true } },
      },
    });
    const active = members.filter((m) => !m.user.deactivatedAt);

    console.log(`  ${branch.name} — ${active.length} members`);

    if (branch.subUnits.length === 0) {
      console.log("      (no departments)");
    }

    for (const dept of branch.subUnits) {
      const inDept = active.filter((m) => m.subUnitId === dept.id);
      const lead = dept.leadId
        ? await db.user.findUnique({ where: { id: dept.leadId }, select: { email: true } })
        : null;

      // The count is the point. A department with tasks and no members is a
      // queue nobody is in.
      const taskCount = await db.task.count({ where: { subUnitId: dept.id } });
      const flag = inDept.length === 0 && taskCount > 0 ? "  <-- has tasks, NO MEMBERS" : "";
      console.log(`      ${dept.name}: ${inDept.length} members, ${taskCount} tasks${flag}`);
      // A lead who is not a member of the department they lead does not see
      // its work in their own views, which is silent in every screen.
      const leadIsMember = lead ? inDept.some((m) => m.user.email === lead.email) : false;
      const leadFlag = lead && !leadIsMember ? "  <-- NOT A MEMBER of it" : "";
      console.log(`         lead: ${lead?.email ?? "none"}${leadFlag}`);
      for (const m of inDept) console.log(`         ${m.user.email} · ${m.role}`);
    }

    const noDept = active.filter((m) => !m.subUnitId);
    if (noDept.length > 0) {
      console.log(`      NO DEPARTMENT (${noDept.length}):`);
      for (const m of noDept) console.log(`         ${m.user.email} · ${m.role}`);
    }
    console.log();
  }

  // Tasks whose department has nobody in it — the failure this script exists for.
  const tasks = await db.task.findMany({
    where: { subUnitId: { not: null } },
    select: {
      code: true,
      title: true,
      assigneeUserId: true,
      subUnit: { select: { id: true, name: true } },
    },
  });

  const stranded: string[] = [];
  for (const task of tasks) {
    if (!task.subUnit) continue;
    const count = await db.membership.count({
      where: {
        subUnitId: task.subUnit.id,
        removedAt: null,
        acceptedAt: { not: null },
        user: { deactivatedAt: null },
      },
    });
    if (count === 0) stranded.push(`  ${task.code} — ${task.title} · ${task.subUnit.name}`);
  }

  console.log(`TASKS IN AN EMPTY DEPARTMENT (${stranded.length})\n`);
  if (stranded.length === 0) console.log("  none");
  for (const line of stranded) console.log(line);
  if (stranded.length > 0) {
    console.log(
      "\n  These are assignable — eligibility is decided at branch level — but the" +
        "\n  department they name has nobody in it, so it narrows nothing and the" +
        "\n  assignee suggester has no one to rank.",
    );
  }
}

async function setDepartment(email: string, deptName: string) {
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, deactivatedAt: true },
  });
  if (!user) throw new Error(`No account for ${email}.`);
  if (user.deactivatedAt) throw new Error(`${email} is deactivated.`);

  const memberships = await db.membership.findMany({
    where: { userId: user.id, removedAt: null, acceptedAt: { not: null }, teamId: { not: null } },
    select: {
      id: true,
      role: true,
      subUnitId: true,
      team: { select: { id: true, name: true } },
      subUnit: { select: { name: true } },
    },
  });
  if (memberships.length === 0) throw new Error(`${email} has no active branch membership.`);

  const clearing = deptName.toLowerCase() === "none";
  let target: { id: string; name: string; teamId: string } | null = null;

  if (!clearing) {
    const matches = await db.subUnit.findMany({
      where: { name: { equals: deptName, mode: "insensitive" }, archivedAt: null },
      select: { id: true, name: true, teamId: true, team: { select: { name: true } } },
    });
    if (matches.length === 0) throw new Error(`No department named "${deptName}".`);
    if (matches.length > 1) {
      throw new Error(
        `"${deptName}" exists in more than one branch: ` +
          matches.map((m) => m.team.name).join(", ") +
          ". Departments are per-branch; this script cannot guess which.",
      );
    }
    target = matches[0]!;
  }

  // A department belongs to a branch, so only a membership in THAT branch can
  // point at it. Setting it on a membership in another branch would produce a
  // row the app's own queries treat as inconsistent.
  const eligible = clearing
    ? memberships
    : memberships.filter((m) => m.team?.id === target!.teamId);

  if (eligible.length === 0) {
    throw new Error(
      `${email} has no membership in the branch that owns "${target!.name}". ` +
        `Their branches: ${memberships.map((m) => m.team?.name).join(", ")}.`,
    );
  }

  console.log(`${email}`);
  for (const m of eligible) {
    console.log(
      `  ${m.role} in ${m.team?.name}: ${m.subUnit?.name ?? "(no department)"} -> ${target?.name ?? "(none)"}`,
    );
  }

  if (!EXECUTE) {
    console.log("\nDRY RUN — nothing written. Re-run with --execute.");
    return;
  }

  await db.membership.updateMany({
    where: { id: { in: eligible.map((m) => m.id) } },
    data: { subUnitId: target?.id ?? null },
  });
  console.log(`\nUpdated ${eligible.length} membership(s).`);
}

async function setLead(email: string, deptName: string) {
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, deactivatedAt: true },
  });
  if (!user) throw new Error(`No account for ${email}.`);
  if (user.deactivatedAt) throw new Error(`${email} is deactivated.`);

  const matches = await db.subUnit.findMany({
    where: { name: { equals: deptName, mode: "insensitive" }, archivedAt: null },
    select: { id: true, name: true, teamId: true, leadId: true, team: { select: { name: true } } },
  });
  if (matches.length === 0) throw new Error(`No department named "${deptName}".`);
  if (matches.length > 1) {
    throw new Error(
      `"${deptName}" exists in more than one branch: ` +
        matches.map((m) => m.team.name).join(", ") +
        ". Departments are per-branch; this script cannot guess which.",
    );
  }
  const dept = matches[0]!;

  // A lead who is not a member of the department they lead does not see its
  // work in their own views. Three departments here are in exactly that state,
  // so this refuses to add a fourth.
  const membership = await db.membership.findFirst({
    where: {
      userId: user.id,
      subUnitId: dept.id,
      removedAt: null,
      acceptedAt: { not: null },
    },
    select: { role: true },
  });
  if (!membership) {
    throw new Error(
      `${email} is not a member of ${dept.name}. Put them in it first with ` +
        `--set-department, or the lead cannot see the department's work.`,
    );
  }

  const current = dept.leadId
    ? await db.user.findUnique({ where: { id: dept.leadId }, select: { email: true } })
    : null;

  console.log(`${dept.name} (${dept.team.name})`);
  console.log(`  lead: ${current?.email ?? "none"} -> ${user.email} (${membership.role})`);

  if (!EXECUTE) {
    console.log("\nDRY RUN — nothing written. Re-run with --execute.");
    return;
  }

  await db.subUnit.update({ where: { id: dept.id }, data: { leadId: user.id } });
  console.log("\nUpdated.");
}

async function main() {
  const leadEmail = arg("set-lead");
  if (leadEmail) {
    const dept = arg("department");
    if (!dept) throw new Error("--set-lead needs --department <name>.");
    await setLead(leadEmail, dept);
    console.log();
  }

  const email = arg("set-department");
  if (email) {
    const to = arg("to");
    if (!to) throw new Error("--set-department needs --to <department name|none>.");
    await setDepartment(email, to);
    console.log();
  }
  await report();
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
