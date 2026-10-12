# python-server

FastAPI RAG service. It embeds files into Milvus and a BM25 index, then answers queries with hybrid retrieval and the remote fine-tuned LLM. It is internal: it has no auth, and only node-server should call it.

| Route | Purpose |
|---|---|
| `GET /` | Liveness (`{"message": "Hello World"}`) |
| `POST /embed` | `{file_paths, collection_name}`. Paths point into node-server's `UPLOAD_TMP_DIR`, which this process must be able to read. |
| `POST /query` | `{query, collection_name, history}` |

## Run

```bash
cd python-server                 # required: config.yaml and data/bm25_indices/ are relative paths
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python app/main.py               # :8080; needs Milvus at MILVUS_URI (default http://localhost:19530)
```

## Read next

- Pipeline and parameters: [docs/system-architecture.md](../docs/system-architecture.md#query-flow)
- Where to change what: [docs/codebase-summary.md](../docs/codebase-summary.md)
- LLM endpoint, env vars, index reset: [docs/deployment-guide.md](../docs/deployment-guide.md)
- Retrieval evaluation: [evaluation/README.md](evaluation/README.md)
- Known defects: [docs/project-roadmap.md](../docs/project-roadmap.md)
