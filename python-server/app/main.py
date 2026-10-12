from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn
from services.rag_service import RAGService
from typing import List

app = FastAPI()

rag_service = RAGService()


class QueryRequest(BaseModel):
    query: str
    collection_name: str
    history: List[str]
class EmbedRequest(BaseModel):
    file_paths: List[str]
    collection_name: str

@app.get("/")
def read_root():
    return {"message": "Hello World"}


@app.post("/query")
def query(request: QueryRequest):
    # Keyword arguments: the third positional parameter is use_hybrid, not history
    return rag_service.query_documents(
        query=request.query,
        collection_name=request.collection_name,
        history=request.history,
    )

@app.post("/embed")
def embed(request: EmbedRequest):
    return rag_service.embed_documents(request.file_paths, request.collection_name)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
