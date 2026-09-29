"""Manual comparisons must use two chronological photos of the same site."""

import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app import main, story


def photo(eid: str, site_id: str, taken_at: str) -> dict:
    return {
        "id": eid,
        "site_id": site_id,
        "resource_type": "image",
        "status": "ready",
        "review": {"status": "pending"},
        "exif": {"taken_at": taken_at},
    }


class PairValidationTests(unittest.TestCase):
    def setUp(self):
        self.project = {
            "id": "project_1",
            "sites": [{"id": "site_1", "name": "Lake"}, {"id": "site_2", "name": "Other lake"}],
            "evidence": [
                photo("early", "site_1", "2026-08-01T12:00:00"),
                photo("late", "site_1", "2026-09-01T12:00:00"),
                photo("elsewhere", "site_2", "2026-09-01T12:00:00"),
            ],
        }

    def update(self, before: str, after: str):
        with patch.object(main.store, "get", return_value=self.project), patch.object(main.store, "audit"), patch.object(main, "build_view", return_value={}):
            return main.update_site("project_1", "site_1", main.SitePatch(pair={"before": before, "after": after}))

    def test_reversed_pair_is_rejected(self):
        with self.assertRaises(HTTPException) as error:
            self.update("late", "early")
        self.assertEqual(error.exception.status_code, 400)
        self.assertNotIn("pair", self.project["sites"][0])

    def test_other_site_is_rejected(self):
        with self.assertRaises(HTTPException) as error:
            self.update("early", "elsewhere")
        self.assertEqual(error.exception.status_code, 400)
        self.assertNotIn("pair", self.project["sites"][0])

    def test_valid_pair_is_saved(self):
        self.update("early", "late")
        self.assertEqual(self.project["sites"][0]["pair"], {"before": "early", "after": "late"})

    def test_auto_pair_requires_nearby_positions_when_gps_exists(self):
        for ev in self.project["evidence"][:2]:
            ev["exif"].update(lat=18.5204, lng=73.8567, heading=90)
        proofs = {eid: {"grade": "strong"} for eid in ("early", "late")}
        pair = story.pair_for_site(self.project, self.project["sites"][0], proofs)
        self.assertEqual((pair["before"], pair["after"]), ("early", "late"))
        self.project["evidence"][1]["exif"]["lat"] = 18.5304
        self.assertIsNone(story.pair_for_site(self.project, self.project["sites"][0], proofs))


if __name__ == "__main__":
    unittest.main()
