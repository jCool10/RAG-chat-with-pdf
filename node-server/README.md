# node-server

Express + TypeScript API. It owns auth (per-user RS256 JWTs), workspaces, chat history and S3 uploads, and proxies embed and query calls to python-server. It is the only public backend.

Routes live in `src/routes/`. Everything is mounted under `/api` except `GET /healthCheck`.

## Run

Use Node 22 (as the Dockerfile does). Node 26 crashes at startup inside `jsonwebtoken`'s dependencies.

```bash
cd node-server
yarn install
# create .env first: see docs/deployment-guide.md#environment-variables
yarn dev          # nodemon + tsx, :8000 by default (PORT)
yarn build        # rimraf dist && tsc && tsc-alias  (tsc-alias is required for @/ imports)
yarn start        # node dist/index.js
yarn lint / yarn prettier
```

No test runner is configured.

## Read next

- Auth model and request flows: [docs/system-architecture.md](../docs/system-architecture.md)
- Conventions (layering, response and error shapes, `req.user`): [docs/code-standards.md](../docs/code-standards.md#node-server-conventions)
- Where to change what, and misspelled filenames to grep for: [docs/codebase-summary.md](../docs/codebase-summary.md)
- Known defects, including security: [docs/project-roadmap.md](../docs/project-roadmap.md)
