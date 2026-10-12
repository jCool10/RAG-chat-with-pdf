# Deployment Guide

## Supported setups

| Setup | Use it for | Status |
|---|---|---|
| **Local:** Milvus in Docker, the three apps on the host | Development | Works end to end |
| **Docker Compose:** everything in containers | Demo on one machine | Wiring fixed; not yet run end to end with real MongoDB, S3 and vLLM |

Either way, the embed step has one constraint. node-server downloads uploads into a directory and sends those *paths* to python-server ([architecture](system-architecture.md#embed-flow)), so both processes must see that directory. Locally that is the OS temp directory. In Compose it is the `upload_tmp` volume, mounted at `/shared/uploads` in both containers.

## Environment variables

Each service reads its own configuration. No `env.example` is committed; create the files below by hand and never commit them.

### `node-server/.env` (loaded by `dotenv` from the working directory)

The source of truth is `node-server/src/configs/index.ts`, plus `src/services/encryption.service.ts` for the two master keys.

| Variable | Needed | Notes |
|---|---|---|
| `DB_URL` | yes | MongoDB connection string. |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_BUCKET` | yes | S3 bucket for uploads. The server does not start without `AWS_BUCKET`. |
| `ACCESS_TOKEN_VALIDITY_SEC`, `REFRESH_TOKEN_VALIDITY_SEC` | yes | Lifetimes in seconds, e.g. `3600` and `86400`. **Default is 0, which makes every token expire immediately.** |
| `MASTER_ENCRYPTION_KEY` | yes | Encrypts users' private keys at rest. Generate once with `openssl rand -base64 32` and never change it. If it is unset, a random key is used per process, and existing users cannot log in after a restart. |
| `MASTER_SECRET` | yes | Derives private-key passphrases. Falls back to a hardcoded default if unset. Set it, and treat changing it like changing the master key. |
| `PORT` | no | Default `8000`. |
| `NODE_ENV` | no | `production` hides error stacks and Mongoose query logging. |
| `RAG_API_URL` | no | python-server base URL. Default: `http://python-server:8080` when `NODE_ENV=production`, otherwise `http://0.0.0.0:8080`. |
| `UPLOAD_TMP_DIR` | no | Where uploads are downloaded before embedding. Default: the OS temp directory. python-server must be able to read it. |

`configs/index.ts` also declares variables for OpenAI, Hugging Face, `DB_HOST`/`DB_*`, and token issuer and audience. No live code path uses them.

### `client/.env.local`

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_URL` | node-server origin as the browser sees it, **with a trailing slash and without `/api`**, e.g. `http://localhost:8000/`. The client's endpoint paths already start with `api/`, and the token-refresh URL is built by string concatenation, so a missing slash breaks refresh. Next inlines this value at **build** time. |

### python-server

| Variable | Notes |
|---|---|
| `MILVUS_URI` | Default comes from `config.yaml` (`http://localhost:19530`). |
| `HUGGING_FACE_HUB_TOKEN` | Only needed for gated models. |

The LLM endpoint is a constant (`LLM_API`) in `python-server/app/services/rag_service.py`. Update it whenever the vLLM server's address changes.

### Root `.env` (Docker Compose only)

`docker-compose.yml` interpolates these values from a root `.env`:
- `DB_URL`
- `AWS_*`
- `MASTER_ENCRYPTION_KEY`, `MASTER_SECRET`
- optionally `ACCESS_TOKEN_VALIDITY_SEC` and `REFRESH_TOKEN_VALIDITY_SEC` (default 3600 and 86400)
- optionally `NEXT_PUBLIC_API_URL` (default `http://localhost:3001/`)
- optionally `HUGGING_FACE_HUB_TOKEN`

Compose already sets `PORT`, `NODE_ENV`, `RAG_API_URL`, `UPLOAD_TMP_DIR` and `MILVUS_URI`.

## Local run

Prerequisites: Docker, Node 22 (matches the Dockerfiles; Node 26 fails inside `jsonwebtoken`'s dependencies), Yarn, Python 3.11. You also need a reachable MongoDB, the S3 bucket, and the vLLM server.

1. Start Milvus: `docker-compose up -d etcd minio milvus`. Wait until `docker-compose ps` shows it healthy, which can take about 2 minutes on first start.
2. python-server: `cd python-server`, create a venv, `pip install -r requirements.txt`, then `python app/main.py`. Run it from `python-server/`, because `config.yaml` and the BM25 directory are relative paths. The first start downloads `BAAI/bge-m3` and the cross-encoder from Hugging Face.
3. node-server: create `node-server/.env`, then `yarn install && yarn dev`.
4. client: create `client/.env.local`, then `yarn install && yarn dev`.

## Docker Compose

```bash
docker-compose up -d --build
```

| Service | Host port | Notes |
|---|---|---|
| client | `3000` | `NEXT_PUBLIC_API_URL` is a build argument. Changing it requires `--build`. |
| node-server | `3001` → 3000 | Image sets `NODE_ENV=production` and `PORT=3000`. |
| python-server | `127.0.0.1:8080` | Bound to localhost only, because it has no auth. Starts after Milvus is healthy. |
| Milvus / MinIO | `19530`, `9091` / `9000`, `9001` | |

`node-server/logs` is bind-mounted. On Linux, create it beforehand and make it writable by UID 1001.

## Health checks

| Service | Check | Meaning |
|---|---|---|
| client | `curl http://localhost:3000` | Next is serving. |
| node-server | `curl http://localhost:8000/healthCheck` (Compose: `:3001`) | Express is up. It does not check MongoDB, S3 or python-server. |
| python-server | `curl http://localhost:8080/` | Returns `{"message":"Hello World"}`. Liveness only. |
| Milvus | `curl http://localhost:9091/healthz` | Milvus is ready. |

## Upload limits

`node-server/src/middlewares/multer.middleware.ts` enforces up to 10 files per request, 50 MB per file, and only `.pdf`, `.docx` and `.txt`. Violations return 400. JSON bodies are capped at 1 MB. Login and register are rate-limited to 20 attempts per IP per 15 minutes, as one combined counter (`src/middlewares/rate-limit.middleware.ts`).

## LLM server (vLLM on GCP)

The model `jCool10/jCool10-LLaMA3-VietQA-3B-merged` is served by vLLM on a GPU VM (`vllm-llm-instance`). It exposes `POST /v1/chat/completions` on port 8000.

```bash
gcloud compute ssh vllm-llm-instance

# Docker
sudo apt update && sudo apt install -y docker.io
sudo usermod -aG docker $USER && newgrp docker

# NVIDIA driver, then reboot and SSH back in
sudo apt install -y nvidia-driver-525-server
sudo reboot

# NVIDIA Container Toolkit
distribution=$(. /etc/os-release; echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list \
  | sudo tee /etc/apt/sources.list.d/nvidia-docker.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker
docker run --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi   # GPU visible?

# Serve the model; pass the HF token from the VM's environment, never inline it
docker run --gpus all --name my_vllm_container --ipc=host -p 8000:8000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  --env HUGGING_FACE_HUB_TOKEN="$HUGGING_FACE_HUB_TOKEN" \
  vllm/vllm-openai:latest \
  --model jCool10/jCool10-LLaMA3-VietQA-3B-merged --max-model-len 4096
```

Then set `LLM_API` in `python-server/app/services/rag_service.py` to `http://<vm-ip>:8000/v1/chat/completions`. The endpoint is plain HTTP with no auth, so restrict the VM firewall to the app host's IP.

## Resetting indexes

Changing chunking, the splitter or the embedding model invalidates existing indexes. For each affected workspace slug, drop its Milvus collection, delete `python-server/data/bm25_indices/<slug>.pkl`, and re-embed. There is no re-embed endpoint: `reEmbedFiles` exists in node-server but is not routed.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Every request returns 401 "jwt expired" right after login | `ACCESS_TOKEN_VALIDITY_SEC` and `REFRESH_TOKEN_VALIDITY_SEC` are unset (0). |
| Existing users cannot log in after a restart | `MASTER_ENCRYPTION_KEY` was unset or changed. |
| Client calls go to `/api/api/...` or `.../apiapi/...` | `NEXT_PUBLIC_API_URL` includes `/api` or lacks the trailing slash. In Docker, rebuild the client after fixing it. |
| Embed fails with "File ... does not exist" | python-server cannot read node-server's download directory. Check `UPLOAD_TMP_DIR` and the shared volume. |
| A workspace returns 404 for a logged-in user | It belongs to another user. Workspaces are scoped to their owner. |
| python-server fails at import | Started from the wrong directory (`config.yaml` not found), or Milvus is unreachable. `RAGService` connects to Milvus at import time. |
| Answers are a fixed Vietnamese placeholder string | The vLLM endpoint returned a non-200 status. Check the VM and `LLM_API`. |
| node-server crashes in `buffer-equal-constant-time` (`SlowBuffer`) | Running on a Node release that removed `SlowBuffer` (seen on v26). Use Node 22. |
