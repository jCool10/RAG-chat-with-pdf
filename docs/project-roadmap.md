# Project Roadmap

A stateful backlog, not a spec. Every item below was confirmed by reading source on 2026-10-12. Items marked *(inferred)* were not reproduced at runtime. When an item is fixed, delete it; git history keeps the record.

## Security

1. **Leaked credentials are still valid until rotated.** They have been removed from the working tree, but git history still contains them:
   - a Hugging Face token (`llm/main.py`, and the former `DEPLOY.md`);
   - a Firebase service-account private key (`node-server/config.json`, now untracked and ignored);
   - MongoDB and AWS credentials (the former root `env.example`, deleted in commit `9dfa857`).

   Revoke and rotate each one. Then decide whether to rewrite history; this needs a force-push and a re-clone by every collaborator.
2. **`MASTER_SECRET` has a hardcoded fallback** in `node-server/src/services/encryption.service.ts` and `src/utils/encryption.util.ts`. Fail at startup instead when it is unset.
3. **The vLLM endpoint is plain HTTP on a raw IP with no auth.** Restrict it by firewall, or put it behind a proxy with a token.
4. **Mongoose query debug logging** prints query values, including refresh tokens on keystore updates, to stdout when `NODE_ENV` is not `production`.

## Broken or incorrect behavior

| # | Issue | Where |
|---|---|---|
| 1 | The hybrid path never reranks. The non-hybrid fallback returns 3 documents, not 5. | `python-server/app/core/retrievers/hybrid_searcher.py`, `app/core/vector_stores/milvus.py` `query` |
| 2 | BM25 tokenization is whitespace-only: `underthesea` is not in `requirements.txt`. If it were installed, its `_`-joined tokens would be dropped by the `isalnum` filter. | `app/core/indices/bm25_index.py` |
| 3 | Each `/embed` call replaces the collection's BM25 index instead of extending it. This is harmless while workspaces are embedded only once. | `bm25_index.py` `build_index` |
| 4 | The LLM call has no timeout, and network errors are not caught. | `python-server/app/services/rag_service.py` |
| 5 | A failed embed leaves an orphan Workspace record with `isEmbedded: false`. | `node-server/src/services/files.service.ts` `embedFiles` |
| 6 | The workspace page uploads with `fetch('/api/files/upload/:slug')`, a route that does not exist. | `client/app/(root)/workspace/[slug]/page.tsx` |
| 7 | No client route guard: `ProtectedProvider` is imported but not rendered. The sidebar and header also render on the auth pages. The API itself is protected. | `client/app/layout.tsx` |
| 8 | Requests queued during a token refresh hang if the refresh response has no tokens. | `client/utils/axios.ts` |
| 9 | The "Forgot password?" link points to a page that does not exist. | `client/app/(auth)/login/page.tsx` |
| 10 | User key pairs have a TTL index and are deleted about 1 year after creation, whatever their status. Data encrypted through `/api/auth/encrypt` then becomes unrecoverable. | `node-server/src/models/userKeyPair.model.ts` |
| 11 | The nDCG formula uses `log2(i)` instead of `log2(i+1)`, so the reported nDCG is above 1 and invalid. | `python-server/evaluation/rag_evaluator.py` |

## Deployment

- The Docker Compose wiring was fixed, and the node-server and client images build and start. The full stack has not been run end to end against real MongoDB, S3 and vLLM, and the python-server image was not rebuilt after its one-line change.
- The LLM endpoint is a hardcoded constant and should become an env var.

## Evaluation snapshot

**Retrieval:** `python-server/evaluation/evaluation_results_evaluation_collection_20250622_155501.json`, 20 queries, run 2025-06-22.

| Mode | MRR | P@1 | P@5 | Recall@5 |
|---|---|---|---|---|
| Dense | 0.850 | 0.80 | 0.31 | 0.900 |
| Sparse (BM25) | 0.852 | 0.80 | 0.32 | 0.925 |
| Hybrid (RRF) | 0.917 | 0.90 | 0.34 | 0.925 |

Caveats:
- Dense ran with the default limit of 3, which caps its @5 numbers.
- nDCG is invalid (issue 11).
- The input data and ground truth live in the gitignored `data/` directory, so this run cannot be reproduced from the repo.
- The run predates the history fix, so no answer used conversation history.

**Generation:** `llm/evaluation_results/evaluation_summary.json`, produced by `evaluate_model` in `llm/main.py` on 50 test samples (run date unknown); the chart is `metrics_distribution.png` next to it. ROUGE-1 0.416, ROUGE-2 0.256, ROUGE-L 0.275, BLEU 0.078.

## Cleanup candidates

- `llm/requirements.txt` omits `unsloth`, `rouge_score` and `nltk`. `llm/main.py` trains, pushes to the Hub and logs to W&B as soon as it is executed or imported.
- Duplicate `useAuth` hooks: `client/context/AuthContext.tsx` (raw state) and `client/hooks/useAuth.ts` (adds mutations).
- `findBySlug` in `node-server/src/repositories/worksapce.repo.ts` is no longer used, because slug lookups go through the owner-scoped `findBySlugAndUser`.
- The client has no ESLint config, so `next lint` is interactive.

## Open decisions

| Decision | Options |
|---|---|
| How python-server gets the files | It currently reads paths from a shared directory (`UPLOAD_TMP_DIR`, the `upload_tmp` volume in Compose). Alternative: python-server downloads from S3 by key, which removes the shared-filesystem constraint but needs S3 credentials in python-server. |
| UI language | Vietnamese, English, or i18n. See [design-guidelines.md](design-guidelines.md#open-decisions). |
| Workspace lifecycle | Allow adding and removing files and re-embedding (needs a routed `reEmbedFiles` and an incremental BM25 index), or keep workspaces immutable. |
