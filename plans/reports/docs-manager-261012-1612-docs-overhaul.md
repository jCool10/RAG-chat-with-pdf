# Docs overhaul: report

**Date:** 2026-10-12. **Scope:** `/ak:docs update`, a full pass over README, CLAUDE.md, `docs/`, the service READMEs and DEPLOY.md.

## Outcome

All documentation was rewritten against the source. Total size went from about 5,800 lines to 728. Content that paraphrased code, copied version lists, or invented details was removed. The old `docs/` were largely invented:
- a production setup on Kubernetes, Prometheus, CloudWatch;
- design tokens that do not exist;
- budgets, team members, stakeholder sign-off;
- the claim that "Node encrypts responses";
- files such as `User.ts` and `file-loader.py`.

The service READMEs described a different project (FAISS/OpenAI, `/api/workspaces`, `llm-evaluation/`).

| File | Before → after (lines) | Change |
|---|---|---|
| `README.md` | 182 → ~60 | Overview, local quick start, doc map |
| `CLAUDE.md` | 134 → ~60 | Corrected facts that would mislead an agent, e.g. "ownership is enforced", `/health`, port 3001, `env.example`, the auth middleware path, googletrans. Kept only process rules |
| `docs/project-overview-pdr.md` | 206 → ~60 | Intent, scope and non-goals, terminology, decisions with reasons |
| `docs/system-architecture.md` | 595 → ~140 | The real embed, query and auth flows, trust boundaries, data ownership |
| `docs/codebase-summary.md` | 571 → ~50 | Navigation, misspelled filenames, dead code |
| `docs/code-standards.md` | 794 → ~50 | Rules that tools do not enforce |
| `docs/design-guidelines.md` | 781 → ~30 | Pointers to the real tokens and components, open decisions |
| `docs/deployment-guide.md` | 553 → ~140 | Real env vars, single-host setup, compose blockers, vLLM runbook (merged from DEPLOY.md) |
| `docs/project-roadmap.md` | 378 → ~100 | Verified bug backlog, evaluation snapshot, open decisions |
| `DEPLOY.md` | deleted | Content merged into the deployment guide. The file held a live HF token |
| `client/`, `node-server/`, `python-server/`, `python-server/evaluation/` READMEs | 1,582 → ~90 | Short run instructions and links to `docs/` |

Evidence: three read-only verification agents (node-server, python-server with translator/llm, client with infra), plus spot checks of `files.service.ts`, `configs/index.ts`, `routes/index.ts`, `utils/axios.ts`, `app/main.py` and `rag_service.py`. Validation: a script confirmed that every internal link and anchor resolves. A grep confirmed that no secret values and none of the old false claims remain in the docs.

## Needs action by the owner (not done: outside a docs operation)

1. **Revoke and rotate:**
   - the HF token (`llm/main.py`, and git history of `DEPLOY.md`);
   - the Firebase service-account key (`node-server/config.json`);
   - the MongoDB and AWS credentials (history of `env.example`, commit `9dfa857`).
   Then decide whether to purge git history.
2. **Security bugs:** no workspace ownership check, password hash inside the JWT, upload path traversal, and the unauthenticated `POST /upload`. See `docs/project-roadmap.md#security`.
3. **Critical functional bugs:** `/query` history lands in `use_hybrid`, and `req.user._id` makes refresh always return 401. See `docs/project-roadmap.md#broken-or-incorrect-behavior`.

## Proposed removals (not done)

- Root `image.png`, `evalua.json`: move next to `llm/` or delete.
- Root `milvus.yaml` (not mounted), plus `python-server/docker-compose.yml` and `python-server/milvus.yaml` (a duplicate Milvus stack).
- `node-server/logs/.*-audit.json`: untrack it and add `logs/` to `.gitignore`.
- Dead client code and unused dependencies (list in the roadmap).

## Unresolved questions

- Is `jCool10/jCool10-LLaMA3-VietQA-3B-merged` (the served model) the merged output of `llm/main.py` (`jCool10/chat_anything-3B-merged`)? The source does not say.
- Run date of `evalua.json`: unknown.
- Milvus rejecting slugs that start with a digit, and upload path traversal, were found by reading code and not run. The `/api/api` issue is only a wrong `NEXT_PUBLIC_API_URL` format, which the deployment guide now documents.
- Docs language: kept in English, following the latest commit. Do the service READMEs need Vietnamese?
