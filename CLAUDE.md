# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Product intent and architecture are in `README.md` and `docs/`. Before navigating code, read `docs/codebase-summary.md`. Before trusting any behavior, check `docs/project-roadmap.md`, which lists verified bugs.

## Services

| Path | Stack | Default port |
|---|---|---|
| `client/` | Next.js 14 App Router, shadcn/ui, yarn | 3000 |
| `node-server/` | Express + TypeScript, Mongoose, yarn | 8000 (`PORT`) |
| `python-server/` | FastAPI, Milvus, BM25 | 8080 |
| `translator/`, `llm/` | Offline Python scripts (dataset translation, LoRA fine-tune) | — |

## Commands

```bash
docker-compose up -d etcd minio milvus     # infra only, for local dev; `up -d --build` runs the full stack
cd python-server && python app/main.py     # must run from python-server/ (relative config.yaml, BM25 dir)
cd node-server && yarn dev | yarn build | yarn lint | yarn prettier
cd client && yarn dev | yarn typecheck | yarn format:check | yarn build
```

- `node-server` build is `rimraf dist && tsc && tsc-alias`. Never run bare `tsc`: the `@/` imports break.
- Use Node 22 for node-server. Node 26 crashes at startup inside `jsonwebtoken`'s dependencies.
- `client` `yarn lint` (`next lint`) is interactive because no ESLint config exists. Do not run it in automation.
- No tests and no CI exist. **Done** means: typecheck/lint/prettier pass for the TS packages you touched, and you exercised the affected flow against the running stack (health: `:8000/healthCheck`, `:8080/`, `:9091/healthz`). If you could not run it, say so.

## Facts that prevent wrong changes

- **Shared upload directory.** node-server sends file *paths* (under `UPLOAD_TMP_DIR`) to python-server `/embed`, so both must read the same directory. Locally that is the OS temp dir; in Compose it is the `upload_tmp` volume.
- **python-server has no auth.** All auth and ownership checks belong in node-server. Any new slug-based handler must load the workspace through `findOwnedWorkspace` in `node-server/src/services/files.service.ts`.
- **JWT payload is `{ user: { _id, email, name } }`.** Read the caller as `req.user.user._id`. Only build tokens through `createTokens` (`src/utils/jwt.ts`); never put more user fields in them.
- **Auth headers:** `authorization` carries the raw access token (no `Bearer`), plus `client-id`. Only `POST /api/auth/refresh-token` reads the `refresh-token` header. The middleware is `node-server/src/utils/auth.util.ts`, not `middlewares/`. Keep the 401 messages: the client refreshes on `jwt expired` and logs out on `Unauthorized`.
- **`query_documents` arguments:** the third positional parameter is `use_hybrid`, not `history`. Call it with keyword arguments.
- **`python-server/config.yaml` is partly dead.** Grep `app/` for a key before relying on it. The LLM endpoint is the `LLM_API` constant in `rag_service.py`; do not add more hardcoded hosts.
- **Index invalidation:** changing chunking, the splitter or the embedding model requires dropping the Milvus collection and `data/bm25_indices/<slug>.pkl` for every workspace.
- **Env quirks:** `NEXT_PUBLIC_API_URL` is the node origin with a trailing `/` and no `/api`. `ACCESS_TOKEN_VALIDITY_SEC`/`REFRESH_TOKEN_VALIDITY_SEC` default to 0, which means instant expiry. `MASTER_ENCRYPTION_KEY` must never change. Full table: `docs/deployment-guide.md#environment-variables`.
- **Misspelled filenames** (grep these exact names): `services/keyStore,service.ts`, `repositories/worksapce.repo.ts`, `helpers/cathAsync.ts`.
- **Dead code:** do not build on it. The unrendered `ProtectedProvider`, the `apikey` middleware, and the unrouted `reEmbedFiles`.

## Never

- Commit, print or copy credentials. The repo has leaked them before, and git history still holds them. `node-server/config.json` may still exist locally (it is gitignored); never read it into output or copy it into an image.
- Log passwords, password hashes, tokens, key material, DB URIs or full emails.
- Create `.md` files outside `docs/` or `plans/` unless asked.

## Conventions

- TypeScript `strict` in both TS packages. Do not add `any`.
- node-server layering: route → controller → service → repository → model. Return `SuccessResponse`; throw `BaseError` subclasses (`src/core/`).
- File naming: kebab-case or `<name>.<layer>.ts` in TS, PascalCase for React components, snake_case for Python.
- Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:` …). Do not mention AI tools.
