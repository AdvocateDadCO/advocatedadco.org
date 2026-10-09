"""Fail-closed checks for approved public static files. Findings never include source excerpts."""
import argparse
import gzip
import hashlib
import io
import json
import posixpath
import re
import sys
import zipfile
import unicodedata
from html.parser import HTMLParser
from html import unescape
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit

SITE_HOSTS = {"advocatedadco.org", "www.advocatedadco.org"}
TEXT_TYPES = {".html", ".css", ".js", ".json", ".xml", ".txt", ".csv", ".svg"}
SECRET_PATTERNS = [
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("provider-token", re.compile(r"\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,})\b")),
    ("credential-assignment", re.compile(r"""(?i)\b(?:password|passwd|api[_-]?key|api[_-]?token|client[_-]?secret|access[_-]?token)\b\s*["']?\s*[:=]\s*["'][^"'\s]{4,}["']""")),
    ("embedded-authorization", re.compile(r"(?i)\bBearer\s+[A-Za-z0-9_+/=-]{20,}\b")),
    ("credential-url", re.compile(r"(?i)\b[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@")),
]
PRIVATE_PATTERNS = [
    ("confidential-marker", re.compile(r"(?i)\b(?:confidential|internal use only|not for publication|private [a-z]+ records?|privileged and confidential)\b")),
]


class Page(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.links, self.ids, self.title, self.anchor = [], set(), [], None
        self.in_title = False
        self.searchable, self.noindex = False, False
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.add(attrs["id"])
        if tag == "a" and attrs.get("name"):
            self.ids.add(attrs["name"])
        self.searchable |= "data-pagefind-body" in attrs
        if tag == "meta" and attrs.get("name", "").lower() == "robots":
            self.noindex |= "noindex" in attrs.get("content", "").lower()
        if tag == "title":
            self.in_title = True
        if tag == "a":
            self.anchor = {"href": attrs.get("href", ""), "text": ""}
        for key in ("href", "src", "poster", "data"):
            if attrs.get(key) and tag != "base":
                self.links.append((attrs[key], tag, key))
        if attrs.get("srcset"):
            self.links.extend((p.strip().split()[0], tag, "srcset") for p in attrs["srcset"].split(",") if p.strip())
        if attrs.get("style"):
            self.links.extend((p, tag, "style") for p in css_urls(attrs["style"]))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)
        if self.anchor is not None:
            self.anchor["text"] += data

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag == "a" and self.anchor:
            self.links.append((self.anchor["href"], "a-label", self.anchor["text"].strip()))
            self.anchor = None


def css_urls(text):
    return re.findall(r"""url\(\s*["']?([^"'\s)]+)""", text, re.I)


def resolve(source, reference, files):
    """Resolve URL paths using Pages' static HTML routes; preserve encoded literal question marks."""
    if not reference or reference.startswith(("data:", "mailto:", "tel:", "javascript:", "blob:")):
        return None
    url = urlsplit(urljoin("https://advocatedadco.org/" + source, reference))
    if url.hostname not in SITE_HOSTS:
        return None
    raw = unquote(url.path).lstrip("/")
    candidates = [raw, raw + ".html", raw.rstrip("/") + "/index.html"]
    if raw in ("", "/"):
        candidates = ["index.html"]
    found = next((p for p in candidates if p in files), None)
    return found, unquote(url.fragment), raw


def fragment_json(data):
    payload = gzip.decompress(data)
    if payload.startswith(b"pagefind_dcd"):
        payload = payload[len(b"pagefind_dcd"):]
    return json.loads(payload)


def normalized(text):
    return " ".join(re.findall(r"[^\W_]+", unicodedata.normalize("NFKC", unescape(text)).casefold()))


def wording_occurrences(text, exceptions):
    """Exact reviewed outside names only; putting arbitrary wording in quotes is insufficient."""
    value = normalized(text)
    spans = []
    for exception in exceptions:
        title = normalized(exception["title"])
        spans.extend((m.start(), m.end()) for m in re.finditer(r"(?<!\w)" + re.escape(title) + r"(?!\w)", value))
    return [m for m in re.finditer(r"\bvisually impaired\b", value)
            if not any(start <= m.start() and m.end() <= end for start, end in spans)]


def private_phrase_match(text, hashes):
    # Public code contains digests only. Never include the matched words in evidence.
    words = normalized(text).split()
    wanted = set(hashes)
    return any(hashlib.sha256(" ".join(words[start:start+size]).encode()).hexdigest() in wanted
               for size in range(2, 17) for start in range(len(words)-size+1)) if wanted else False


def validate(files, config):
    findings = []
    def fail(code, filename, target=None):
        safe_name = filename if filename in config["approved_public_files"] else "unapproved:" + hashlib.sha256(filename.encode()).hexdigest()[:12]
        item = {"code": code, "file": safe_name}
        if target is not None and code in {"missing-file", "missing-fragment", "search-missing-page", "search-stale-page"}:
            item["target"] = target if target in config["approved_public_files"] or target.split("#")[0] in config["approved_public_files"] else "missing:" + hashlib.sha256(target.encode()).hexdigest()[:12]
        if item not in findings:
            findings.append(item)

    approved = config["approved_public_files"]
    actual = {}
    for name, data in files.items():
        actual[name] = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if approved.get(name) != actual[name]:
            fail("public-approval-required", name)
        parts = name.lower().split("/")
        if any(p.startswith(".") or p in {"private", "internal", "confidential", "secrets", "operating-system"} for p in parts) or Path(name).suffix.lower() in {".pem", ".key", ".p12", ".pfx", ".docx", ".xlsx"}:
            fail("private-file-type-or-path", name)
    if set(approved) != set(files):
        for name in sorted(set(approved) - set(files)):
            fail("approval-list-out-of-date", name)

    pages = {}
    text_files = {}
    for name, data in files.items():
        suffix = Path(name).suffix.lower()
        if suffix in TEXT_TYPES:
            try:
                text_files[name] = data.decode("utf-8")
            except UnicodeDecodeError:
                fail("unreadable-text", name)
        elif suffix == ".pdf":
            try:
                from pypdf import PdfReader
                reader = PdfReader(io.BytesIO(data))
                text_files[name] = "\n".join(p.extract_text() or "" for p in reader.pages)
                if not text_files[name].strip():
                    fail("pdf-text-review-required", name)
            except Exception:
                fail("pdf-text-check-failed", name)
        elif suffix == ".pf_fragment":
            try:
                text_files[name] = json.dumps(fragment_json(data), ensure_ascii=False)
            except Exception:
                fail("search-corrupt-fragment", name)

    for name, text in text_files.items():
        visible = unescape(re.sub(r"<[^>]*>", " ", text)) if name.endswith((".html", ".svg")) else text
        views = text + "\n" + visible
        if name.endswith(".json"):
            try: views += "\n" + json.dumps(json.loads(text), ensure_ascii=False)
            except Exception: pass
        if wording_occurrences(views, config.get("official_wording_exceptions", [])):
            fail("own-wording-review-required", name)
        if private_phrase_match(views, config.get("private_phrase_hashes", [])):
            fail("private-phrase-digest-match", name)
        for code, pattern in SECRET_PATTERNS + PRIVATE_PATTERNS:
            if pattern.search(views):
                fail(code, name)
        if name.endswith(".html"):
            try:
                pages[name] = Page(text)
            except Exception:
                fail("html-parse-failed", name)

    for name, text in text_files.items():
        references = []
        if name in pages:
            references = pages[name].links
        elif name.endswith(".css"):
            references = [(r, "css", "") for r in css_urls(text)]
        elif name.endswith(".js") and not name.startswith("pagefind/"):
            refs = re.findall(r"""(?:fetch|import|new Audio)\(\s*["']([^"']+)["']""", text)
            references = [(r, "js", "") for r in refs]
        elif name.endswith(".json") and not name.startswith("pagefind/"):
            try:
                def walk(value):
                    if isinstance(value, dict):
                        for child in value.values(): yield from walk(child)
                    elif isinstance(value, list):
                        for child in value: yield from walk(child)
                    elif isinstance(value, str) and re.match(r"^(?:/?(?:images|audio|downloads|resources)/)", value):
                        yield value
                references = [(r, "json", "") for r in walk(json.loads(text))]
            except Exception:
                fail("json-parse-failed", name)
        for reference, tag, attr in references:
            resolved = resolve(name, reference, files)
            if resolved is None:
                continue
            target, fragment, raw = resolved
            is_test = raw in {"test", "test.html", "test-access", "test-access.html"}
            if name not in config["test_pages"] and (is_test or tag == "a-label" and re.match(r"(?i)^TEST\b", attr)):
                fail("test-link-outside-test-pages", name)
            if target is None:
                fail("missing-file", name, raw)
            elif fragment and target in pages and fragment not in pages[target].ids:
                fail("missing-fragment", name, target + "#" + fragment)

    entry_name = "pagefind/pagefind-entry.json"
    indexed = {}
    try:
        entry = json.loads(files[entry_name])
        if entry["version"] != config["pagefind_version"]:
            fail("search-version-mismatch", entry_name)
        required = ["pagefind/pagefind.js", "pagefind/pagefind-ui.js", "pagefind/pagefind-ui.css"]
        for lang in entry["languages"].values():
            required += ["pagefind/pagefind." + lang["hash"] + ".pf_meta", "pagefind/wasm." + lang["wasm"] + ".pagefind"]
        for required_file in required:
            if required_file not in files:
                fail("missing-file", entry_name, required_file)
        for name, data in files.items():
            if name.endswith(".pf_fragment"):
                obj = fragment_json(data)
                resolved = resolve("index.html", obj["url"], files)
                if not resolved or resolved[0] is None:
                    fail("search-stale-page", name, obj["url"])
                elif resolved[0] in indexed:
                    fail("search-duplicate-page", name)
                else:
                    indexed[resolved[0]] = obj
        if len(indexed) != sum(l["page_count"] for l in entry["languages"].values()):
            fail("search-page-count-mismatch", entry_name)
        if not any(n.startswith("pagefind/index/") and n.endswith(".pf_index") for n in files):
            fail("search-missing-index-chunks", entry_name)
        for name, page in pages.items():
            if page.searchable and not page.noindex and name not in config["search_exclusions"] and name not in config["test_pages"]:
                if name not in indexed:
                    fail("search-missing-page", entry_name, name)
        for name in indexed:
            if name in config["test_pages"]:
                fail("test-page-in-search", name)
            if name in pages and pages[name].noindex:
                fail("noindex-page-in-search", name)
    except Exception:
        fail("search-validation-failed", entry_name)
    return {"passed": not findings, "files_checked": len(files), "html_pages": len(pages), "indexed_pages": len(indexed), "findings": findings}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--site")
    parser.add_argument("--archive")
    parser.add_argument("--config", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    if args.archive:
        with zipfile.ZipFile(args.archive) as z:
            prefix = z.namelist()[0]
            files = {name[len(prefix):]: z.read(name) for name in z.namelist() if not name.endswith("/") and name[len(prefix):].split("/")[0] not in {".git", ".github", ".gitignore", "README.md"}}
    else:
        root = Path(args.site)
        files = {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}
    report = validate(files, config)
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("Public site checks: " + ("passed" if report["passed"] else "BLOCKED") + "; " + str(len(report["findings"])) + " finding(s). Findings contain paths and rule names only.")
    sys.exit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
