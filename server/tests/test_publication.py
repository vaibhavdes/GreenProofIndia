"""Public reports must not expose evidence awaiting a decision."""

import unittest
from unittest.mock import patch

from app import main


def _evidence(eid: str, review: str = "pending") -> dict:
    return {
        "id": eid,
        "public_id": f"greenproof/{eid}",
        "resource_type": "image",
        "status": "ready",
        "uploaded_at": "2026-09-01T00:00:00Z",
        "exif": {"taken_at": "2026-09-01T00:00:00"},
        "site_id": "site_1",
        "activities": [],
        "review": {"status": review},
    }


def _project(weak_review: str = "pending") -> dict:
    return {
        "id": "project_1",
        "name": "Test lake",
        "created_at": "2026-09-01T00:00:00Z",
        "share_token": "test-token",
        "sites": [{"id": "site_1", "name": "Lake", "kind": "lake", "boundary": [], "pair": {"before": "strong", "after": "weak"}}],
        "evidence": [_evidence("strong"), _evidence("weak", weak_review)],
        "measurements": [],
        "stories": [{"id": "story_1", "status": "ready", "created_at": "2026-09-02T00:00:00Z", "sources": ["strong", "weak"]}],
        "audit": [{"at": "2026-09-02T00:00:00Z", "actor": "Private reviewer", "action": "evidence.accepted", "detail": "Sensitive reviewer note", "ref": "weak"}],
    }


def _score(ev: dict, *_args) -> dict:
    return {"grade": "weak" if ev["id"] == "weak" else "strong", "score": 30 if ev["id"] == "weak" else 90, "checks": []}


class PublicationTests(unittest.TestCase):
    def view(self, project: dict, public: bool) -> dict:
        with patch.object(main.store, "all_projects", return_value=[project]), patch.object(main.proof, "score", side_effect=_score), patch.object(main.story, "views", return_value={}):
            return main.build_view(project, public=public)

    def test_pending_weak_item_is_absent_from_all_public_outputs(self):
        project = _project()
        public = self.view(project, public=True)
        self.assertEqual([item["id"] for item in public["evidence"]], ["strong"])
        self.assertEqual(public["metrics"]["evidence"], 1)
        self.assertEqual(public["sites"][0]["metrics"]["evidence"], 1)
        self.assertIsNone(public["sites"][0]["pair"])
        self.assertEqual(public["stories"], [])
        self.assertEqual(len(self.view(project, public=False)["evidence"]), 2)

    def test_accepting_weak_item_makes_pair_and_story_shareable(self):
        project = _project("accepted")
        project["evidence"][1]["review"]["note"] = "Sensitive reviewer note"
        public = self.view(project, public=True)
        self.assertEqual({item["id"] for item in public["evidence"]}, {"strong", "weak"})
        self.assertEqual(next(item for item in public["evidence"] if item["id"] == "weak")["review"], {"status": "accepted"})
        self.assertEqual(public["metrics"]["evidence"], 2)
        self.assertIsNotNone(public["sites"][0]["pair"])
        self.assertEqual([item["id"] for item in public["stories"]], ["story_1"])
        with patch.object(main.store, "all_projects", return_value=[project]), patch.object(main.proof, "score", side_effect=_score):
            provenance = main._provenance(project, project["evidence"][1], public=True)
        self.assertEqual(provenance["events"][0]["actor"], "team")
        self.assertNotIn("Sensitive", str(provenance))

    def test_story_without_recorded_sources_is_not_public(self):
        project = _project("accepted")
        project["stories"][0]["sources"] = []
        self.assertEqual(self.view(project, public=True)["stories"], [])


if __name__ == "__main__":
    unittest.main()
