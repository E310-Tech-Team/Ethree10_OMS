# 04 — UI/UX Design Brief

**Product:** Ethree10 OMS (E310)
**Last updated:** 20 September 2026

Source of truth for tokens is `tailwind.config.ts` and `app/globals.css`. This document
explains the intent; the config is the implementation.

---

## 1. Design principles

1. **Answer "what do I do next", not "what is the data".** A stage badge reading `submitted`
   is a fact about a record. "Nobody has picked this up, 4 days" is the thing a reader needs.
   See `lib/request-triage.ts`.
2. **Show people only what they can act on.** Sidebar items the role cannot use are not
   rendered — no disabled decoration, no dead ends.
3. **Name the branch, not the state of assignment.** A list showing "Assigned"/"Unassigned"
   without saying *whose* is a list nobody can triage.
4. **One signature accent per view.** Lime is a highlight, not a palette.
5. **Say what is missing and why.** Empty states explain the cause and the next action —
   "No tasks yet. Create one before anybody can be assigned."

---

## 2. Brand

**Ethree10 (E310)** — a Reach4Christ Global initiative.
Positioning line: *Excellence through People, Process, Product.*

The wordmark is an official asset, rendered through `components/brand/e310-logo.tsx`
(`E310Logo`, `E310Mark`) in `dark` and `white` variants. **Never set the name as text** — a
hardcoded `E10` on the magic-link page was a real defect, fixed in PR #80.

---

## 3. Colour

Three families, defined in `tailwind.config.ts`.

### Brand — teal (primary)

| Step | Hex | Use |
|---|---|---|
| 50 | `#e6faf8` | Tinted backgrounds |
| 100 | `#c0f2ed` | |
| 200 | `#8ae7df` | |
| 300 | `#4dd6cc` | |
| 400 | `#1ec1b6` | |
| **500** | **`#05b1a4`** | **Primary actions, links, focus** |
| 600 | `#049488` | Hover |
| 700 | `#06756d` | Active |
| 800 | `#0a5d57` | |
| 900 | `#0d4d49` | |
| 950 | `#022e2b` | |

### Ink — navy

Dark surfaces, headings, the sidebar, signature cards.
`50 #f3f5f7` · `100 #e7e7e7` · `200 #c8d2db` · `300 #9aabba` · `400 #5e768c` ·
`500 #33495b` · `600 #1b3247` · `700 #0f2438` · `800 #081d30` · `900 #051a2c` ·
`950 #031629`

### Lime — accent

Sparing. Badges and **one highlight per view**.
`50 #fbfde9` · `100 #f4facb` · `200 #ebf69e` · `300 #ddef6f` · `400 #ccec63` ·
`500 #b4d93f` · `600 #8fb52b`

### Semantic tokens

shadcn/ui semantics map to CSS variables in `app/globals.css` and are the only colours
components should reference directly:

`background` · `foreground` · `primary` · `secondary` · `destructive` · `muted` · `accent` ·
`popover` · `card` · plus a dedicated `sidebar` set (`background`, `foreground`, `primary`,
`accent`, `border`, `ring`).

> Use semantic tokens in components. Reach for `brand-*` / `ink-*` / `lime-*` only for
> deliberate brand moments.

**Dark mode** is class-based (`darkMode: ["class"]`) and tokens are defined for both themes.

---

## 4. Typography

**Poppins** — geometric, rounded, modern. Self-hosted via `next/font/local` in weights
400/500/600/700, exposed as `--font-poppins`. Self-hosting is deliberate: no third-party
font request on boot, and nothing to add to `font-src`.

| Family | Stack |
|---|---|
| `font-sans` | `var(--font-poppins)` → system sans |
| `font-display` | same as sans |
| `font-mono` | `var(--font-jetbrains-mono)` → system mono |

Headings carry `font-semibold`; page titles are `text-4xl` on marketing and `text-2xl` in
app cards. Supporting copy uses `text-sm text-muted-foreground`; metadata `text-xs`.

---

## 5. Layout

| Context | Convention |
|---|---|
| App shell | Fixed sidebar (`app-sidebar.tsx`) + scrolling content |
| Sidebar sections | Overview · Operations · Delivery Leadership · Money · Agency · Administration |
| Marketing | Centred, `max-w-6xl`, header + footer |
| Legal / prose | `max-w-3xl`, `space-y-6`, `py-16` |
| Auth | Centred card, `max-w-md`, no sidebar |
| Spacing | Tailwind scale; `space-y-6` between sections, `gap-4` in rows |

### Radius and elevation

Radius derives from `--radius`: `sm` = −4px, `md` = −2px, `lg` = base, `xl` = +6px.

| Shadow | Use |
|---|---|
| `soft` | Resting cards |
| `pop` | Menus, popovers, dialogs |
| `glow` | Brand-teal ring for emphasis |

### Motion

One keyframe, `fade-up` (8px rise, 400ms, `cubic-bezier(0.2,0.8,0.2,1)`), exposed through
`AnimatedPage` / `AnimatedSection` with a `delay` prop for staggering. Motion is for arrival
only — it never gates interaction.

---

## 6. Components

### Base — `components/ui/` (shadcn/ui over Radix)

`avatar` · `badge` · `button` · `card` · `dialog` · `dropdown-menu` · `input` · `label` ·
`popover` · `scroll-area` · `select` · `separator` · `skeleton` · `switch` · `table` ·
`tabs` · `textarea` · `toast` · `toaster` · `tooltip`

### Extended — `components/ui-ext/`

| Component | Purpose |
|---|---|
| `animated` | `AnimatedPage`, `AnimatedSection` |
| `empty-state` | Explains why a list is empty and what to do |
| `page-header` | Title, description, actions |
| `stat-card` | A single number with its label |
| `status-pill` | Lifecycle state |
| `urgency-tag` | Urgency, coloured by severity |

New primitives follow shadcn patterns and live in `ui/`; app-specific variants go in `ui-ext/`.

---

## 7. Accessibility

**Target: WCAG 2.1 AA. Current state: partial and unaudited** — recorded honestly rather
than claimed.

Done:
- Semantic landmarks; sidebar sections use `aria-labelledby` tied to section headings
- Radix primitives bring focus traps, roles and keyboard behaviour
- Decorative icons marked `aria-hidden`
- Form fields have associated `<Label>`s; errors render as text, not colour alone
- Keyboard navigation and a global search shortcut

Outstanding:
- No contrast audit across all token pairs (lime on white is the likely failure)
- No `prefers-reduced-motion` handling for `fade-up`
- No screen-reader pass over the delivery flows
- Focus-visible styling not verified on every interactive element

---

## 8. Writing

The interface explains consequences, not mechanics.

| Situation | Write |
|---|---|
| Blocked by configuration | "This is a server configuration problem, not something you did." |
| Empty list with a cause | "No tasks exist, so nobody can be assigned work yet." |
| Destructive action | Name what is lost and whether it can be undone |
| Credential | "Your tracking link is a private access credential." |
| Never | Blame the user for the system's misconfiguration |

British English. Sentence case for headings and buttons. Roles use their product names —
**Branch** and **Department**, never `Team` or `SubUnit`.

---

## 9. Known issues

| Issue | Status |
|---|---|
| Contrast never audited | Open |
| `prefers-reduced-motion` not handled | Open |
| `Team`/`SubUnit` leak into any raw data view | Open — see [02-TRD §7](02-TRD.md#7-technical-debt) |
| Marketing home not reachable at `/` | `/` 307s to `/login`; `/services` and `/about` carry the full layout |

---

## Related documents

- [01-PRD.md](01-PRD.md) · [02-TRD.md](02-TRD.md) · [03-App-Flow.md](03-App-Flow.md) · [05-Backend-Schema.md](05-Backend-Schema.md) · [06-Implementation-Plan.md](06-Implementation-Plan.md)
