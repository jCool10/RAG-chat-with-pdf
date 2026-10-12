# Design Guidelines

The client is built on shadcn/ui (Radix primitives with Tailwind). Follow shadcn conventions and do not invent a parallel system.

## Where the design system lives

| Concern | Owner |
|---|---|
| Color tokens, light and dark | `client/styles/globals.css` (`:root` and `.dark` HSL variables, including `--sidebar-*`) |
| Token → Tailwind mapping, radius, container | `client/tailwind.config.js` |
| shadcn generator settings | `client/components.json` |
| Primitives | `client/components/ui/`. Add new ones with the shadcn CLI so they match `components.json`. |
| Font | `client/lib/fonts.ts` |
| Theme switching | `next-themes` in `client/components/providers/index.tsx`: class strategy, default `system`. Toggle in `client/components/theme-toggle.tsx`. |

## Rules

- Use semantic token classes (`bg-background`, `text-muted-foreground`, `border-border`) and not raw colors, so dark mode works without extra code.
- Compose screens from `components/ui/` primitives. Shared app pieces go in `components/shared/`, the shell in `components/layouts/`, and dialogs in `components/modals/`.
- Keep Radix accessibility intact. Do not replace a primitive's trigger or focus handling with plain `div`s. Icon-only buttons need an `aria-label`.
- The layout is desktop-first. `client/hooks/use-mobile.tsx` exists for the sidebar sheet on small screens. Do not take on wider mobile work without a decision (see Open decisions).

## Open decisions

- **UI language.** Strings are mixed. The home page and workspace toasts are Vietnamese; login, register and create-workspace are English. The root `<html lang>` is `en`. Pick one language, or add i18n, before adding new screens.
- **Site metadata.** `client/config/site.ts` still holds the template defaults.
