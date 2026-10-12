import os
import time
import yaml
import logging
import requests
from typing import Dict, Any, List
from concurrent.futures import ThreadPoolExecutor, as_completed

from core.text_splitters.sentence_splitter import SentenceSplitter
from core.vector_stores.milvus import MilvusVectorStore
from core.document_loaders.file_loader import FileLoader
from core.retrievers.hybrid_searcher import HybridSearchEngine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

LLM_API = "http://35.221.160.224:8000/v1/chat/completions"

class RAGService:
    def __init__(self, max_workers: int = 4):
        self.config = self._load_config()
        
        # Get Milvus connection details from environment variables or config
        # milvus_host = os.environ.get("MILVUS_HOST", self.config["vector_store"]["host"])
        # milvus_port = os.environ.get("MILVUS_PORT", self.config["vector_store"]["port"])

        milvus_uri = os.environ.get("MILVUS_URI", self.config["vector_store"]["uri"])
        
        self.splitter = SentenceSplitter(
            chunk_size=self.config["document_processing"]["chunk_size"],
            chunk_overlap=self.config["document_processing"]["chunk_overlap"],
        )
        self.vector_store = MilvusVectorStore(
            uri=milvus_uri,
            embedding_name=self.config["vector_store"]["embedding_name"],
        )
        
        # Initialize hybrid search engine
        self.hybrid_engine = HybridSearchEngine(
            vector_store=self.vector_store,
            config=self.config
        )
        
        self.max_workers = max_workers  # Maximum number of threads

    def _load_config(self, config_path: str = "config.yaml") -> Dict[str, Any]:
        """Load configuration from YAML file."""
        with open(config_path, "r") as f:
            config = yaml.safe_load(f)
        return config

    def _embed_document(self, file_path: str, collection_name: str) -> Dict[str, Any]:
        """Embed a document and add it to the collection.

        Args:
            file_path: Path to the file to be embedded
            collection_name: Name of the Milvus collection

        Returns:
            Dictionary containing the embedding results
        """
        try:
            if not os.path.exists(file_path):
                logger.error(f"File does not exist: {file_path}")
                return {
                    "code": 400,
                    "success": False,
                    "message": "File does not exist",
                    "data": None,
                }

            loader = FileLoader(
                file_path=file_path,
            )
            documents = loader.load()

            if not documents:
                logger.warning(f"Could not load document from: {file_path}")
                return {
                    "code": 400,
                    "success": False,
                    "message": "Could not load document",
                    "data": None,
                }

            chunks = self.splitter.split_documents(documents)

            if not chunks:
                logger.warning(f"Could not split document into chunks: {file_path}")
                return {
                    "code": 400,
                    "success": False,
                    "message": "Could not split document into chunks",
                    "data": None,
                }

            result = self.vector_store.add(chunks, collection_name)

            if result:
                return {
                    "success": True,
                    "code": 200,
                    "message": "Documents embedded successfully",
                    "data": result,
                    "chunks": chunks  # Return chunks for BM25 indexing
                }
            else:
                return {
                    "success": False,
                    "code": 500,
                    "message": "Failed to embed documents",
                    "data": None,
                }

        except Exception as e:
            logger.error(f"Error processing file {file_path}: {str(e)}")
            return {"code": 500, "success": False, "message": str(e), "data": None}

    def embed_documents(self, file_paths: List[str], collection_name: str):
        """Embed multiple documents in parallel using multithreading and build BM25 index.

        Args:
            file_paths: List of paths to files for embedding
            collection_name: Name of the Milvus collection

        Returns:
            Dictionary containing the embedding results
        """
        if not file_paths:
            return {
                "code": 400,
                "success": False,
                "message": "No files provided",
                "data": None,
            }

        total_files = len(file_paths)
        logger.info(
            f"Starting embedding {total_files} files into collection {collection_name} with {self.max_workers} threads"
        )

        results = []
        successful = 0
        failed = 0
        all_chunks = []  # Collect all chunks for BM25 indexing

        # Determine optimal number of workers (no more than number of files)
        workers = min(self.max_workers, total_files)

        # Use ThreadPoolExecutor for parallel processing
        with ThreadPoolExecutor(max_workers=workers) as executor:
            # Create futures for each file
            futures = {
                executor.submit(
                    self._embed_document, file_path, collection_name
                ): file_path
                for file_path in file_paths
            }

            # Collect results as they complete
            for future in as_completed(futures):
                res = future.result()
                results.append(res)
                if res["success"]:
                    successful += 1
                    # Collect chunks for BM25 indexing
                    chunks = res.get("chunks", [])
                    all_chunks.extend(chunks)
                else:
                    failed += 1

        logger.info(
            f"Completed embedding {total_files} files. Success: {successful}, Failed: {failed}"
        )

        # Nothing was indexed, so the workspace would be unusable; let the caller see the failure
        if successful == 0:
            return {
                "code": 500,
                "success": False,
                "message": "; ".join(res.get("message", "") for res in results) or "No documents were embedded",
                "data": {"embedding_results": results, "bm25_index": None},
            }

        # Build BM25 index if hybrid search is enabled
        bm25_result = None
        if self.config.get("hybrid_search", {}).get("enabled", False) and all_chunks:
            logger.info(f"Building BM25 index with {len(all_chunks)} chunks")
            bm25_success = self.hybrid_engine.build_bm25_index(collection_name, all_chunks)
            bm25_result = {
                "success": bm25_success,
                "chunks_indexed": len(all_chunks) if bm25_success else 0
            }

        return {
            "code": 200,
            "success": True,
            "message": "Documents embedded successfully",
            "data": {
                "embedding_results": results,
                "bm25_index": bm25_result
            },
        }

    def _create_prompt_from_docs(self, query: str, docs: List[Dict], history: List[str] = None) -> str:
        """Create a prompt from retrieved documents for LLM processing.

        Args:
            query: The original user query
            docs: List of retrieved documents

        Returns:
            Formatted prompt string for LLM
        """
        context_parts = []

        # Extract content from retrieved documents
        for i, doc in enumerate(docs):
            content = doc.get("text", "")

            if content:
                # Add document with source info
                context_parts.append(f"Document {i+1}:\n{content}\n")

        # Combine all documents into a single context
        context = "\n".join(context_parts)

        # node-server sends alternating question/answer strings, oldest first
        history_text = "\n".join(history) if history else ""

        # Create the prompt with instructions, context and query
        prompt = f"""
        Bạn là một trợ lý thông minh. Dựa vào các đoạn ngữ cảnh được cung cấp, hãy trả lời câu hỏi của người dùng một cách chính xác, rõ ràng và tự nhiên.

        Ngữ cảnh:
        {context}

        {"LỊCH SỬ CUỘC TRÒ CHUYỆN:" if history_text else ""}
        {history_text}

        Câu hỏi hiện tại:
        {query}

        Yêu cầu:
        - Trả lời ngắn gọn, đúng trọng tâm, dựa trên ngữ cảnh.
        - Ưu tiên thông tin từ tài liệu được cung cấp để trả lời
        - Nếu không đủ thông tin, hãy nói rõ là chưa có thông tin.
        - Không bịa thêm nội dung ngoài ngữ cảnh.
        """

        return prompt

    def query_documents(self, query: str, collection_name: str, use_hybrid: bool = None, history: List[str] = None):
        """Query documents using hybrid or dense search and prepare a prompt for LLM.

        Args:
            query: User query string
            collection_name: Name of the collection to search
            use_hybrid: Override hybrid search setting (None=use config, True/False=override)

        Returns:
            Response including retrieved documents and LLM prompt
        """
        # Determine if we should use hybrid search
        if use_hybrid is None:
            use_hybrid = self.config.get("hybrid_search", {}).get("enabled", False)
            
        final_k = self.config.get("hybrid_search", {}).get("final_k", 5)
        
        if use_hybrid:
            # Use hybrid search
            search_result = self.hybrid_engine.search(
                query=query,
                collection_name=collection_name,
                top_k=final_k,
                use_hybrid=True
            )
            
            if search_result.get("success", False):
                docs = search_result.get("results", [])
                search_method = search_result.get("search_method", "hybrid")
                search_stats = {
                    "method": search_method,
                    "fusion_method": search_result.get("fusion_method"),
                    "search_time": search_result.get("search_time"),
                    "fusion_stats": search_result.get("fusion_stats")
                }
            else:
                # Fall back to dense search
                docs = self.vector_store.query(query, collection_name)
                search_method = "dense_fallback"
                search_stats = {"method": search_method}
        else:
            # Use dense search only
            docs = self.vector_store.query(query, collection_name)
            search_method = "dense"
            search_stats = {"method": search_method}

        # Create a prompt for LLM from the retrieved documents
        llm_prompt = self._create_prompt_from_docs(query, docs, history)

        # Call LLM API
        response = requests.post(LLM_API, json={
            "model": "jCool10/jCool10-LLaMA3-VietQA-3B-merged",
            "messages": [
                {
                    "role": "user", 
                    "content": llm_prompt
                    }
            ],
            "max_tokens": 1000
        })

        if response.status_code == 200:
            response_data = response.json()
            response_text = response_data.get("choices", [{}])[0].get("message", {}).get("content", "")
        else:
            response_text = "Đây là kết quả trả về từ LLLM"

        return {
            "code": 200,
            "success": True,
            "message": "Documents queried successfully",
            "data": {
                "docs": docs, 
                "response": response_text,
                "search_stats": search_stats,
                "total_docs": len(docs)
            },
        }

    def get_collection_stats(self, collection_name: str):
        """Get statistics for a collection including hybrid search capabilities.
        
        Args:
            collection_name: Name of the collection
            
        Returns:
            Dictionary containing collection statistics
        """
        stats = self.hybrid_engine.get_collection_stats(collection_name)
        
        return {
            "code": 200,
            "success": True,
            "message": "Collection stats retrieved successfully",
            "data": stats
        }

    def rebuild_bm25_index(self, collection_name: str, file_paths: List[str]):
        """Rebuild BM25 index for a collection.
        
        Args:
            collection_name: Name of the collection
            file_paths: List of file paths to rebuild index from
            
        Returns:
            Dictionary containing rebuild results
        """
        try:
            # Load and process documents
            all_chunks = []
            for file_path in file_paths:
                if os.path.exists(file_path):
                    loader = FileLoader(file_path=file_path)
                    documents = loader.load()
                    chunks = self.splitter.split_documents(documents)
                    all_chunks.extend(chunks)
            
            if not all_chunks:
                return {
                    "code": 400,
                    "success": False,
                    "message": "No documents found to build index",
                    "data": None
                }
            
            # Build BM25 index
            success = self.hybrid_engine.build_bm25_index(collection_name, all_chunks)
            
            return {
                "code": 200,
                "success": success,
                "message": "BM25 index rebuilt successfully" if success else "Failed to rebuild BM25 index",
                "data": {
                    "chunks_indexed": len(all_chunks) if success else 0
                }
            }
            
        except Exception as e:
            logger.error(f"Error rebuilding BM25 index: {e}")
            return {
                "code": 500,
                "success": False,
                "message": str(e),
                "data": None
            }

    def delete_collection(self, collection_name: str):
        """Delete a collection and its associated BM25 index.
        
        Args:
            collection_name: Name of the collection to delete
            
        Returns:
            Dictionary containing deletion results
        """
        # Delete vector store collection
        vector_result = self.vector_store.delete(collection_name)
        
        # Delete BM25 index
        bm25_result = self.hybrid_engine.clear_bm25_index(collection_name)
        
        return {
            "code": 200,
            "success": True,
            "message": "Collection deleted successfully",
            "data": {
                "vector_store": vector_result,
                "bm25_index_cleared": bm25_result
            },
        }
