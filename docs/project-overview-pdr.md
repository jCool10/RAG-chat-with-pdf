# Project Overview

## What and why

RAG Chat with PDF lets a user drop a set of documents into a workspace and ask questions about them in Vietnamese or English. The system retrieves the most relevant passages and has a small fine-tuned LLM answer from them, showing the passages as sources.

It is a capstone project. It demonstrates three things end to end:

1. A retrieval pipeline that works on Vietnamese text, where pure embedding search misses exact terms and pure keyword search misses paraphrase.
2. A domain LLM built in-house: English instruction datasets translated to Vietnamese (`translator/`), then used to LoRA fine-tune Llama 3.2 3B (`llm/`).
3. A multi-user web app around both, with per-user workspaces.

## Users

Students, researchers and analysts who need answers from a few long documents (lecture notes, papers, reports, contracts) and want to see the passages each answer came from.

## Scope

**In scope**

- Register, log in, log out, refresh tokens, rotate a user's RSA key pair.
- Create a workspace by uploading up to 10 files (PDF, DOCX, TXT) in one request.
- Ask questions in a workspace; persist the Q&A history and the source passages per workspace.
- Hybrid retrieval (dense + BM25) per workspace; answer generation by the remote fine-tuned model.
- Offline tooling to translate datasets, fine-tune the model, and evaluate retrieval and generation.

**Out of scope (non-goals)**

- OCR. Text is extracted with `pypdf`, so scanned PDFs produce no chunks.
- Adding files to, or removing files from, an existing workspace. A workspace is created from one upload.
- Sharing workspaces between users, or real-time collaboration.
- Mobile-first UI.
- Hosting the LLM inside the app stack. The model runs on a separate GPU server.

## Terminology

| Term | Meaning |
|---|---|
| Workspace | A named set of uploaded files plus its chat history. Owned by one user. |
| Slug | Random 10-character ID of a workspace. It is used in URLs and as the Milvus collection name and BM25 index file name. |
| Embed | Turning a workspace's files into chunks, vectors (Milvus) and a BM25 index. Happens once, at workspace creation. |
| Source docs | The retrieved chunks returned with an answer and stored next to it in the chat history. |
| Hybrid search | Dense vector search and BM25 keyword search run separately, then merged with Reciprocal Rank Fusion (RRF). |
| Keystore | The MongoDB record holding a user's current public key and refresh token. Deleting it logs the user out everywhere. |

## Key decisions

| Decision | Why |
|---|---|
| Hybrid dense + BM25 retrieval, fused with RRF | Vietnamese queries often hinge on exact terms that embeddings blur. RRF merges two rankings without calibrating their score scales. In the retrieval evaluation, hybrid had the best MRR (see [roadmap evaluation snapshot](project-roadmap.md#evaluation-snapshot)). |
| `BAAI/bge-m3` embeddings | Multilingual model with Vietnamese support, usable on CPU. |
| One Milvus collection and one BM25 file per workspace | Isolates workspaces at the storage layer and makes deleting a workspace's index trivial. |
| Fine-tune a 3B model and serve it with vLLM on a GPU VM | A 3B model fits one GPU. vLLM exposes an OpenAI-compatible API, so the RAG service needs only an HTTP call. Keeping the GPU outside the app stack lets the app run on a laptop. |
| Per-user RSA key pair; JWTs signed with the user's private key | A leaked key affects one user only. Deleting the keystore record revokes every token for that user. |
| node-server is the only public API | All auth and ownership logic lives in one place. python-server has no auth and must stay on the internal network. |

How these are implemented: [system-architecture.md](system-architecture.md).
What is known to be broken or missing: [project-roadmap.md](project-roadmap.md).
