# Codebase Map

Navigation only. Read the code for behavior; read [system-architecture.md](system-architecture.md) for how the parts interact. To list files, run `git ls-files <dir>`.

## Where to start

| Task | Start at |
|---|---|
| Add or change an API endpoint | `node-server/src/routes/*.route.ts` → `src/controllers/` → `src/services/` → `src/repositories/` |
| Change auth, tokens or key handling | `node-server/src/utils/auth.util.ts`, `src/services/auth.service.ts`, `src/utils/jwt.ts`, `src/utils/encryption.util.ts`, `src/middlewares/rate-limit.middleware.ts` |
| Change workspace access rules | `findOwnedWorkspace` in `node-server/src/services/files.service.ts` |
| Change upload limits, types or storage | `node-server/src/middlewares/multer.middleware.ts`, `src/utils/s3.ts` |
| Change chunking, embedding or Milvus usage | `python-server/app/services/rag_service.py`, `app/core/text_splitters/`, `app/core/vector_stores/milvus.py` |
| Change retrieval or fusion | `python-server/app/core/retrievers/hybrid_searcher.py`, `app/core/fusion/score_fusion.py`, `app/core/indices/bm25_index.py` |
| Change the LLM prompt or endpoint | `python-server/app/services/rag_service.py` |
| Change a page | `client/app/(root)/` (signed-in pages), `client/app/(auth)/` (login, register) |
| Change how the client calls the API | `client/utils/axios.ts` (instance, interceptor, `endpoints`), `client/apis/` |
| Change client auth state | `client/context/AuthContext.tsx` |
| Change UI tokens or primitives | `client/styles/globals.css`, `client/tailwind.config.js`, `client/components/ui/` |
| Run retrieval evaluation | `python-server/evaluation/rag_evaluator.py` |
| Translate a dataset | `translator/translator/data_parser.py`, parsers in `translator/examples/*/` |
| Fine-tune or evaluate the LLM | `llm/main.py` (results in `llm/evaluation_results/`) |
| Change the Docker stack | `docker-compose.yml`, `*/dockerfile` or `*/Dockerfile` |

## Entry points

| Service | Entry | Config owner |
|---|---|---|
| client | `client/app/layout.tsx` (root layout, providers, sidebar) | `client/config/global-config.ts` (`NEXT_PUBLIC_API_URL`) |
| node-server | `node-server/src/index.ts` → `src/configs/express.config.ts` → `src/routes/index.ts` | `node-server/src/configs/index.ts` (every env var) |
| python-server | `python-server/app/main.py` (FastAPI app, three routes) | `python-server/config.yaml`, plus the `MILVUS_URI` env var |
| translator | Per-dataset parser scripts in `translator/examples/*/` | `translator/configs/*.py` |
| llm | `llm/main.py`, which trains and evaluates when executed | Constants at the top of `llm/main.py` |

## Naming quirks that break searches

Grep for these exact names. A search for the "correct" spelling misses them.

- `node-server/src/services/keyStore,service.ts` contains a comma.
- `node-server/src/repositories/worksapce.repo.ts` is misspelled.
- `node-server/src/helpers/cathAsync.ts` is misspelled.
- `node-server/dockerfile` and `client/dockerfile` are lowercase. `python-server/Dockerfile` is capitalized.

## Present but not wired in

These files exist but are not on any live code path. Check the call sites before you build on them.

- `client/components/providers/ProtectedProvider.tsx`: imported by the root layout but never rendered, so no client-side route guard runs.
- In node-server: the `apikey` middleware in `src/utils/auth.util.ts` and the ApiKey model, `reEmbedFiles` in `src/controllers/files.controller.ts`, and `findBySlug` in `src/repositories/worksapce.repo.ts`.
