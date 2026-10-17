import importlib.util
import os
import pathlib
import unittest

os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-secret")
os.environ.setdefault("PILOT_TOKEN", "test-token")
spec = importlib.util.spec_from_file_location("bridge", pathlib.Path(__file__).resolve().parents[1] / "bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class MergeTests(unittest.TestCase):
    def test_preserves_unseen_comments(self):
        old = {"1": {"facebook_comment_id": "1", "text": "old"}}
        result = bridge.merge(old, [{"facebook_comment_id": "2", "text": "new"}])
        self.assertEqual({x["facebook_comment_id"] for x in result}, {"1", "2"})

    def test_shorter_comment_cannot_replace_longer(self):
        old = {"1": {"facebook_comment_id": "1", "text": "longer text"}}
        result = bridge.merge(old, [{"facebook_comment_id": "1", "text": "short"}])
        self.assertEqual(result[0]["text"], "longer text")

    def test_requires_stable_identity(self):
        with self.assertRaises(ValueError):
            bridge.merge({}, [{"text": "missing id"}])

if __name__ == "__main__":
    unittest.main()
