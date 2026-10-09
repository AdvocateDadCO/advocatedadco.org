import copy
import gzip
import hashlib
import json
import unittest
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("site_checks", Path(__file__).with_name("site-checks.py"))
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)

def fixture():
    files = {
        "index.html": b'<html><head><title>Ready</title></head><body data-pagefind-body><main id="main"><h1>Ready</h1><a href="#main">Main</a></main></body></html>',
        "pagefind/pagefind-entry.json": json.dumps({"version": "1.5.2", "languages": {"en": {"hash": "en_fixture", "wasm": "en", "page_count": 1}}}).encode(),
        "pagefind/pagefind.js": b"export {};",
        "pagefind/pagefind-ui.js": b"",
        "pagefind/pagefind-ui.css": b"",
        "pagefind/pagefind.en_fixture.pf_meta": b"fixture",
        "pagefind/wasm.en.pagefind": b"fixture",
        "pagefind/index/en_fixture.pf_index": b"fixture",
        "pagefind/fragment/en_fixture.pf_fragment": gzip.compress(b"pagefind_dcd" + json.dumps({"url": "/", "content": "Ready"}).encode()),
    }
    policy = {"test_pages": ["test.html", "test-access.html"], "search_exclusions": [], "pagefind_version": "1.5.2"}
    approve(files, policy)
    return files, policy

def approve(files, policy):
    policy["approved_public_files"] = {name: hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest() for name, data in files.items()}

class SiteChecks(unittest.TestCase):
    def run_case(self, mutate, code):
        files, policy = fixture()
        mutate(files)
        approve(files, policy)
        self.assertIn(code, {item["code"] for item in checks.validate(files, policy)["findings"]})

    def test_valid_public_site(self):
        files, policy = fixture()
        self.assertTrue(checks.validate(files, policy)["passed"])

    def test_missing_image(self):
        self.run_case(lambda f: f.update({"index.html": f["index.html"].replace(b"<h1>", b'<img src="images/missing.webp"><h1>')}), "missing-file")

    def test_missing_pdf(self):
        self.run_case(lambda f: f.update({"index.html": f["index.html"].replace(b"<h1>", b'<a href="/missing.pdf">PDF</a><h1>')}), "missing-file")

    def test_missing_audio(self):
        self.run_case(lambda f: f.update({"index.html": f["index.html"].replace(b"<h1>", b'<audio src="/audio/missing.mp3"></audio><h1>')}), "missing-file")

    def test_missing_anchor(self):
        self.run_case(lambda f: f.update({"index.html": f["index.html"].replace(b"#main", b"#absent")}), "missing-fragment")

    def test_test_link_outside_test_pages(self):
        self.run_case(lambda f: f.update({"index.html": f["index.html"].replace(b'<a href="#main">Main', b'<a href="/test">TEST')}), "test-link-outside-test-pages")

    def test_forbidden_wording(self):
        self.run_case(lambda f: f.update({"index.html": f["index.html"] + b"visually " + b"impaired"}), "own-wording-review-required")

    def test_encoded_visible_wording(self):
        self.run_case(lambda f: f.update({"index.html": f["index.html"] + b"<span>visually</span>&nbsp;impaired"}), "own-wording-review-required")

    def test_official_title_allowed(self):
        files, policy = fixture()
        title = "Teacher of the Visually Impaired"
        policy["official_wording_exceptions"] = [{"title": title, "source": "https://example.org/resource"}]
        files["index.html"] += ('<a href="https://example.org/resource">' + title + '</a>').encode()
        approve(files, policy)
        self.assertTrue(checks.validate(files, policy)["passed"])

    def test_quotes_do_not_approve_own_wording(self):
        self.run_case(lambda f: f.update({"index.html": f["index.html"] + b'"visually impaired families"'}), "own-wording-review-required")

    def test_official_title_does_not_exempt_other_wording(self):
        self.assertEqual(len(checks.wording_occurrences("Teacher of the Visually Impaired, supporting visually impaired families", [{"title": "Teacher of the Visually Impaired"}])), 1)

    def test_private_digest_no_excerpts(self):
        files, policy = fixture()
        phrase = "synthetic restricted manual"
        policy["private_phrase_hashes"] = [hashlib.sha256(phrase.encode()).hexdigest()]
        files["index.html"] += phrase.encode()
        approve(files, policy)
        report = checks.validate(files, policy)
        self.assertIn("private-phrase-digest-match", {r["code"] for r in report["findings"]})
        self.assertNotIn(phrase, json.dumps(report))

    def test_private_marker(self):
        self.run_case(lambda f: f.update({"index.html": f["index.html"] + b"internal use only"}), "confidential-marker")

    def test_private_record_marker(self):
        self.run_case(lambda f: f.update({"index.html": f["index.html"] + b"private synthetic records"}), "confidential-marker")

    def test_hidden_file_is_rejected(self):
        self.run_case(lambda f: f.update({".hidden-fixture": b"synthetic"}), "private-file-type-or-path")

    def test_secret_assignment(self):
        self.run_case(lambda f: f.update({"config.json": b'{"api_' + b'token":"' + b"Z" * 48 + b'"}'}), "credential-assignment")

    def test_unapproved_file_is_redacted(self):
        files, policy = fixture()
        files["unapproved.html"] = b"fixture"
        report = checks.validate(files, policy)
        self.assertIn("public-approval-required", {item["code"] for item in report["findings"]})
        self.assertNotIn("unapproved.html", json.dumps(report))

    def test_corrupt_search(self):
        self.run_case(lambda f: f.update({"pagefind/fragment/en_fixture.pf_fragment": b"broken"}), "search-corrupt-fragment")

    def test_missing_search_page(self):
        self.run_case(lambda f: f.update({"other.html": f["index.html"]}), "search-missing-page")

    def test_stale_search_page(self):
        self.run_case(lambda f: f.update({"pagefind/fragment/en_fixture.pf_fragment": gzip.compress(b"pagefind_dcd" + b'{"url":"/absent","content":"Ready"}')}), "search-stale-page")

    def test_css_asset(self):
        self.run_case(lambda f: f.update({"site.css": b'body{background:url("/images/absent.png")}'}), "missing-file")

    def test_literal_question_mark_path(self):
        files, policy = fixture()
        files["hero.css?v=reviewed.css"] = b"body{}"
        files["index.html"] += b'<link href="/hero.css%3Fv=reviewed.css" rel="stylesheet">'
        approve(files, policy)
        self.assertTrue(checks.validate(files, policy)["passed"])

if __name__ == "__main__":
    unittest.main()
