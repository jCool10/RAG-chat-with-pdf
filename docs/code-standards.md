# Code Standards

Rules that the linters and compilers do not already enforce. For tool configuration, read the config files: `*/tsconfig.json`, `node-server/eslint.config.mjs`, `*/.prettierrc` or `prettier.config.js`. For commands, read each `package.json` `scripts` block.

## All services

- **No secrets in the repo.** This includes config JSON, compose files, deploy notes and scripts. Read credentials from environment variables. Tokens, keys and connection strings have leaked through every one of those file types (see [roadmap: security](project-roadmap.md#security)).
- **No new hardcoded hosts or IPs.** Add an env var and document it in [deployment-guide.md](deployment-guide.md#environment-variables).
- **Never log credentials or personal data.** That covers passwords, password hashes, tokens, key material, connection strings and full emails. Request logging already drops the `authorization`, `refresh-token` and `cookie` headers (`node-server/src/configs/express.config.ts`).
- **Commits** use Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:` …). Do not mention AI tools.

## TypeScript (client, node-server)

- `strict` is on in both `tsconfig.json` files. Do not add `any`. A lot of existing `any` remains; do not copy it.
- Both use the `@/` path alias. node-server needs `tsc-alias` after `tsc` to rewrite it, which `yarn build` already does. Running bare `tsc` produces broken imports.
- File names:
  - node-server: `<name>.<layer>.ts` (`files.service.ts`, `user.model.ts`, `auth.route.ts`).
  - client: PascalCase for components (`ChatBubble.tsx`), kebab-case for shadcn-style and utility files (`theme-toggle.tsx`, `use-mobile.tsx`).
- The client has no ESLint config, so `yarn lint` (`next lint`) prompts you to create one. node-server has `eslint.config.mjs`.

## node-server conventions

- **Layering:** route → controller → service → repository → model. Controllers stay thin. Business rules go in services. Mongo queries go in repositories.
- **Success responses:** wrap them in `SuccessResponse` from `src/core/success.response.ts`, which serializes `{ message, status, data }`.
- **Failures:** throw a subclass of `BaseError` from `src/core/error.response.ts`. The global `errorHandler` (`src/middlewares/errorHandler.middleware.ts`) turns it into `{ status, message, errors, stack }`. Do not send error responses by hand.
- **Authenticated user:** the JWT payload is `{ user: { _id, email, name } }`, so read the caller as `req.user.user._id`. `req.user._id` is always undefined.
- **Token payload:** build it only through `createTokens` in `src/utils/jwt.ts`, which whitelists those three fields. Anyone holding a token can read its payload.
- **Ownership:** every handler that takes a workspace slug loads the workspace through `findOwnedWorkspace` (`src/services/files.service.ts`). A foreign slug returns 404, not 403, so existence does not leak.

## Python (python-server, translator, llm)

- snake_case for files, functions and variables. PascalCase for classes.
- Use the stdlib `logging` module with a module-level `logger = logging.getLogger(__name__)`. Do not add `print`.
- Run python-server from the `python-server/` directory. `config.yaml` and `data/bm25_indices/` are resolved relative to the working directory.
- Before relying on a `config.yaml` key, confirm the code reads it (`grep -rn <key> app/`). Many keys are not read.
- Changing chunking or the embedding model invalidates existing indexes. Drop the workspace's Milvus collection and delete `data/bm25_indices/<slug>.pkl`, then re-embed.

## Testing

No automated tests exist in any service, and there is no CI. Until there are:

- Verify a change by running the affected flow (register → create workspace → ask a question) and the [health checks](deployment-guide.md#health-checks).
- When adding the first tests, start with what the system owns and what is known to break:
  - workspace ownership, the token payload, and the refresh flow (node-server, integration tests against a disposable MongoDB; run on Node 22);
  - fusion and BM25 index building (python-server, unit tests);
  - the `/query` request contract between node-server and python-server.
- Keep test data and credentials separate from dev. Never point tests at the shared Atlas cluster or the real S3 bucket.
