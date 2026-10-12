# Retrieval evaluation

`rag_evaluator.py` measures retrieval quality for dense, sparse (BM25) and hybrid search through the real `RAGService`. It reports Precision@k, Recall@k, nDCG@k and MRR.

```bash
cd python-server            # config.yaml is resolved from the working directory; Milvus must be running
python evaluation/rag_evaluator.py \
  --collection evaluation_collection \
  --data data/sample_documents.txt \
  --ground-truth data/ground_truth.json \
  [--force-reembed]
```

- `data/` is gitignored. Provide the corpus and the ground-truth JSON yourself.
- The nDCG formula is wrong (values above 1). Ignore nDCG until it is fixed. See [roadmap issue 11](../../docs/project-roadmap.md#broken-or-incorrect-behavior).
- The last committed run and its caveats are summarized in the [evaluation snapshot](../../docs/project-roadmap.md#evaluation-snapshot).

LLM generation metrics (ROUGE, BLEU) come from `llm/main.py`, not from this directory.
