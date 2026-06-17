# Chroma — Open-Source Embedding Database

AI-native vector database for building LLM applications with memory.

## When to Use

- Building RAG (retrieval-augmented generation) applications
- Need local/self-hosted vector database
- Semantic search over documents
- Storing embeddings with metadata

## Installation

```bash
pip install chromadb       # Python
npm install chromadb       # JavaScript/TypeScript
```

## Core Operations

### Create Client & Collection

```python
import chromadb
client = chromadb.Client()                                    # in-memory
client = chromadb.PersistentClient(path="./chroma_db")         # persistent
client = chromadb.HttpClient(host="localhost", port=8000)      # server mode

collection = client.create_collection(name="my_collection")
collection = client.get_collection("my_collection")
```

### Add Documents

```python
collection.add(
    documents=["Doc 1", "Doc 2"],
    metadatas=[{"source": "web"}, {"source": "pdf"}],
    ids=["id1", "id2"]
)
```

### Query (Similarity Search)

```python
results = collection.query(
    query_texts=["machine learning"],
    n_results=5
)

# With metadata filters
results = collection.query(
    query_texts=["Python"],
    where={"source": "web", "difficulty": {"$gte": 3}}
)
```

### Update & Delete

```python
collection.update(ids=["id1"], documents=["Updated"], metadatas=[{"source": "updated"}])
collection.delete(ids=["id1"])
collection.delete(where={"source": "outdated"})
```

## Embedding Functions

```python
# Default: sentence-transformers all-MiniLM-L6-v2
# OpenAI:
from chromadb.utils import embedding_functions
openai_ef = embedding_functions.OpenAIEmbeddingFunction(
    api_key="your-key", model_name="text-embedding-3-small"
)
```

## Server Mode

```bash
chroma run --path ./chroma_db --port 8000
```

## Best Practices

1. Use persistent client to avoid data loss
2. Add metadata for filtering and tracking
3. Batch operations for performance
4. Use filters to narrow search space
5. Use server mode for production multi-user
6. Backup the chroma_db directory regularly
