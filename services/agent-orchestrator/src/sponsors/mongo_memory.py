# File: services/agent-orchestrator/src/sponsors/mongo_memory.py
import os
from datetime import UTC, datetime
from typing import Any

from pymongo import MongoClient


class AtlasSkillMemory:
    """MongoDB Atlas Vector Search store for compiled browser skills and DOM embeddings."""

    def __init__(self, uri: str | None = None, db_name: str = "cobrowse_agent") -> None:
        mongo_uri = uri or os.environ.get("MONGODB_URI", "mongodb://localhost:27017")
        self.client: MongoClient = MongoClient(mongo_uri)
        self.db = self.client[db_name]
        self.skills = self.db["compiled_skills"]

    def save_compiled_skill(
        self,
        domain: str,
        goal: str,
        playwright_code: str,
        dom_embedding: list[float],
        selectors: list[str],
    ) -> str:
        doc = {
            "domain": domain,
            "goal": goal,
            "playwright_code": playwright_code,
            "dom_embedding": dom_embedding,
            "selectors": selectors,
            "version": 1,
            "updated_at": datetime.now(UTC).isoformat(),
        }
        result = self.skills.insert_one(doc)
        return str(result.inserted_id)

    def search_skill_by_vector(
        self, query_embedding: list[float], domain: str, limit: int = 3
    ) -> list[dict[str, Any]]:
        """Executes MongoDB Atlas $vectorSearch to retrieve matching skills or self-heal selectors."""
        pipeline = [
            {
                "$vectorSearch": {
                    "index": "skill_vector_index",
                    "path": "dom_embedding",
                    "queryVector": query_embedding,
                    "numCandidates": 25,
                    "limit": limit,
                    "filter": {"domain": domain},
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "domain": 1,
                    "goal": 1,
                    "playwright_code": 1,
                    "selectors": 1,
                    "score": {"$meta": "vectorSearchScore"},
                }
            },
        ]
        return list(self.skills.aggregate(pipeline))
