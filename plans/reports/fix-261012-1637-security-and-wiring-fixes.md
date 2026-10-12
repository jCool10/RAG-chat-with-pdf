# Security and wiring fixes

This report follows `docs-manager-261012-1612-docs-overhaul.md` and applies the fixes it proposed. Nothing is committed. Some deletions and moves are staged (`git rm`, `git mv`); everything else is unstaged.

## Fixed

### node-server: auth
- **Token contents and verification**
  - JWT payload is now `{user:{_id,email,name}}` and no longer carries the password hash.
  - Verification pins `algorithms:['RS256']`.
- **Middleware split** (`auth.util.ts`)
  - `authentication` accepts only the access token.
  - New `refreshAuthentication` reads the `refresh-token` header and is used only on `/refresh-token`.
- **401 responses**
  - A missing or invalid `client-id` returns 401; before, it returned 500 or 404.
  - An expired token returns 401 "jwt expired". Every other failure returns 401 "Unauthorized".
- **auth.service**
  - Reads `req.user.user`; the old code used the undefined `req.user._id`.
  - Refresh-token reuse deletes the keystore and returns 401.
- **Rate limiting:** login and register share one counter of 20 requests per 15 minutes per IP (new `rate-limit.middleware.ts`).

### node-server: workspaces and uploads
- **Ownership:** `findOwnedWorkspace` guards getWorkspace, getMessages, queryWorkspace and reEmbedFiles. A foreign slug returns 404.
- **Query:** `question` is required. Only the last 3 Q&A pairs are sent as history.
- **Uploads**
  - Only `.pdf`, `.docx` and `.txt` are accepted.
  - Limits are 50 MB per file and 10 files per request.
  - S3 keys use the basename only.
  - Downloads go to `UPLOAD_TMP_DIR` with a path containment check.
  - The unauthenticated `/upload` route was removed.
  - JSON bodies are capped at 1 MB.
  - `MulterError` returns 400.
- **Logging**
  - Request logging drops the auth headers.
  - Removed the `console.log` calls of tokens, keystore data and the DB URI.
  - Error stacks are hidden when `NODE_ENV=production`.
- **Config:** new `RAG_API_URL` and `UPLOAD_TMP_DIR`. Removed the Redis and Firebase config.
- **Dead code and dependencies**
  - Removed `JWT.ts`, `firebase.service.ts` and `communicationKey.ts`.
  - Removed the packages ioredis, firebase-admin, @godaddy/terminus, nanoid and crypto.
  - Untracked `config.json` (Firebase key) and the log audit file. The local copies remain, now gitignored.

### python-server
- `/query` passes keyword arguments, so history reaches the prompt as text. Before, it landed in `use_hybrid`.
- `/embed` reports failure when no file loads.

### Other services and infra
- **`llm/main.py`:** the hardcoded HF token was replaced with `os.environ["HF_TOKEN"]`.
- **`translator/requirements.txt`:** removed the unused googletrans and translators.
- **client:** removed the dead `useFileUpload`, `UploadModal`, `ModalWrapper` and `shared/Sidebar`. The Dockerfile now bakes `NEXT_PUBLIC_API_URL` at build time.
- **Compose**
  - New shared `upload_tmp` volume.
  - node-server gets its env vars and a correct healthcheck.
  - python-server is bound to 127.0.0.1 and waits for a healthy Milvus.
  - The client gets a build arg.
- **Removed files:** three stale `milvus.yaml` and compose copies.
- **Moved files:** `evalua.json` and `image.png` now live in `llm/evaluation_results/`.

### Docs
- Updated to match the code above:
  - `CLAUDE.md` and `README.md`;
  - in `docs/`: `deployment-guide.md`, `project-roadmap.md`, `system-architecture.md`, `codebase-summary.md`, `code-standards.md`;
  - the READMEs of node-server, python-server and evaluation.
- The roadmap claim that a slug can start with a digit was false and was removed.

## Verification

| Check | Result |
|---|---|
| node-server `tsc --noEmit` | pass |
| node-server lint | 0 errors, 45 warnings (55 before) |
| node-server integration script (Node 22, temporary mongo:7) | 23/23 pass. Covers health, removed `/upload`, 401 paths, token payload, HS256 forgery rejected, ownership 404, `.exe` rejected, expiry, refresh, reuse revoke, logout, 429 |
| JWTs in log files | 0. Mongoose dev debug prints them to stdout in non-production (listed in roadmap) |
| python `rag_service` offline check | 8/8 pass, py_compile OK |
| node-server Docker image | builds; smoke test OK (health, no `config.json`, `/shared/uploads` mode 1777) |
| client Docker image | builds; bundle contains the baked API URL |
| `docker compose config -q` | pass |
| docs link checker | no broken links. Path warnings are gitignored, untracked or external names only |

The test container and the server process were stopped. The scripts are in the session scratchpad and are not part of the repo.

## Not verified
- The full Compose stack end to end with real MongoDB, S3 and vLLM.
- The python-server image was not rebuilt after its Dockerfile change (torch is heavy).
- The client UI was not exercised in a browser.

## Left for the user
- **Rotate** the HF token, the Firebase service-account key, and the MongoDB and AWS credentials. All of them are still in git history.
- **Decide on a history rewrite.** It needs a force-push and a re-clone.
- **Review and commit.**
- **Clean up local leftovers:** the Docker images `rag-chat-with-pdf-node-server` and `rag-chat-with-pdf-client`, and the local `node-server/config.json`.

## Not fixed (still in roadmap)
- **python-server:** the hybrid path never reranks, BM25 tokenization, and the LLM call has no timeout.
- **node-server:** a failed embed leaves an orphan workspace, the user-keypair TTL, and the `MASTER_SECRET` fallback.
- **client:** the workspace page's `fetch('/api/files/upload/:slug')` hits a route that does not exist, there is no route guard, the refresh queue can hang, and the forgot-password link is dead.
- **Evaluation:** the nDCG formula.

## Unresolved questions
- Should the client's dead upload `fetch` be removed, or wired to a new upload-to-existing-workspace endpoint? This depends on the workspace lifecycle decision.
- Mongoose debug logs tokens in dev. Should it be turned off by default instead of following `NODE_ENV`?
- Should `MASTER_SECRET` fail at startup when unset? This could lock out existing users who currently rely on the default.
