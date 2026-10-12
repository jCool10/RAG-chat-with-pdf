# client

Next.js 14 (App Router) chat UI built with shadcn/ui, Tailwind and React Query. Pages live in `app/(auth)/` (login, register) and `app/(root)/` (home, create workspace, workspace chat).

## Run

```bash
cd client
yarn install
echo 'NEXT_PUBLIC_API_URL=http://localhost:8000/' > .env.local   # node-server origin, trailing slash, no /api
yarn dev            # :3000
yarn typecheck
yarn format:check / yarn format:write
yarn build && yarn start
```

`yarn lint` runs `next lint`. No ESLint config is committed yet, so the first run prompts you to create one. No tests exist.

## Read next

- API calls, auth headers and the refresh queue: `utils/axios.ts`, explained in [docs/system-architecture.md](../docs/system-architecture.md#authentication)
- Tokens, components and theming: [docs/design-guidelines.md](../docs/design-guidelines.md)
- Where to change what, and dead components to avoid: [docs/codebase-summary.md](../docs/codebase-summary.md)
- Known UI defects: [docs/project-roadmap.md](../docs/project-roadmap.md#broken-or-incorrect-behavior)
