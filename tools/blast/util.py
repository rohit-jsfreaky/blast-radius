"""Shared helpers: ids, text normalisation, forgiving Markdown parsing, git calls."""
import os
import re
import subprocess
import sys

# ---------------------------------------------------------------- ids

_B = r"(?<![A-Za-z0-9_])"          # not glued to a word on the left
_E = r"(?![A-Za-z0-9_]|\.\d)"       # not glued on the right, not a longer dotted id

ID_PATTERNS = {
    "WI": _B + r"WI\d+\.\d+" + _E,
    "L": _B + r"L\d+\.\d+" + _E,
    "H": _B + r"H\d+\.\d+" + _E,
    "F": _B + r"F\d+" + _E,
    "D": _B + r"D\d+" + _E,
    "S": _B + r"S\d+" + _E,
}
ANY_ID = re.compile("|".join("(?P<%s>%s)" % (k, v) for k, v in ID_PATTERNS.items()))
ID_FULL = {k: re.compile("^" + v + "$") for k, v in ID_PATTERNS.items()}
INC_RE = re.compile(r"(?<![A-Za-z0-9_])INC-(\d+)(?![\d.])")
REJECT_ID_RE = re.compile(r"(?<![A-Za-z0-9_])(R\d+\.\d+|INC-?\d+\.\d+)(?![A-Za-z0-9_])")
HASH_RE = re.compile(r"\b[0-9a-f]{7,40}\b")
ORIGIN_KINDS = ("L", "F", "H", "D", "S")


def id_kind(token):
    """'L1.2' -> 'L', 'WI3.1' -> 'WI', else None."""
    token = clean_cell(token)
    for kind, rx in ID_FULL.items():
        if rx.match(token):
            return kind
    if re.match(r"^INC-\d+$", token):
        return "INC"
    return None


def find_ids(text, kinds=None):
    """Every L/F/WI/H/D/S id in text, in order, de-duplicated."""
    out = []
    for m in ANY_ID.finditer(text or ""):
        kind = m.lastgroup
        if kinds and kind not in kinds:
            continue
        if m.group(0) not in out:
            out.append(m.group(0))
    return out


def id_sort_key(ident):
    nums = [int(n) for n in re.findall(r"\d+", ident)]
    return (re.match(r"[A-Z]+", ident).group(0) if re.match(r"[A-Z]+", ident) else "", nums)


# ---------------------------------------------------------------- text

_QUOTES = {"“": '"', "”": '"', "„": '"', "«": '"', "»": '"',
           "‘": "'", "’": "'", " ": " "}


def unify_quotes(s):
    for a, b in _QUOTES.items():
        s = s.replace(a, b)
    return s


def norm(s):
    """Whitespace-insensitive, quote-style-insensitive form used for every 'verbatim' check.
    Line-leading blockquote markers, ** and backticks are ignored on both sides."""
    s = unify_quotes(s or "")
    s = re.sub(r"(?m)^[ \t]*>[ \t]?", "", s)
    s = s.replace("**", "").replace("`", "")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def contains_verbatim(haystack, needle):
    """True when needle appears in haystack after norm(). An ellipsis in the needle ('...' or the
    single character) is a gap: every fragment must appear, in order."""
    hay = norm(haystack)
    ndl = norm(needle).strip('"').strip()
    if not ndl:
        return False
    parts = [p.strip() for p in re.split(r"\.\.\.|…", ndl) if p.strip()]
    pos = 0
    for p in parts:
        i = hay.find(p, pos)
        if i < 0:
            return False
        pos = i + len(p)
    return True


def clean_cell(s):
    """Strip Markdown decoration from one cell/value: bold, italics, backticks, outer spaces."""
    s = (s or "").strip()
    s = re.sub(r"^[*_`]+|[*_`]+$", "", s).strip()
    return s


def strip_outer_quotes(s):
    s = unify_quotes(clean_cell(s))
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        return s[1:-1].strip()
    return s


def split_quotes(cell):
    """A cell holding one or more quoted requirement texts -> list of texts.
    '"a" "b"', '"a"; "b"' and '"a", "b"' give two; quotes inside a sentence are kept."""
    c = unify_quotes(clean_cell(cell))
    if not c:
        return []
    if c.startswith('"') and c.endswith('"') and len(c) >= 2:
        inner = c[1:-1]
        parts = re.split(r'"\s*(?:[;,+/]|\band\b)?\s*"', inner)
        return [p.strip() for p in parts if p.strip()]
    found = re.findall(r'"([^"]+)"', c)
    if found:
        return [f.strip() for f in found if f.strip()]
    return [c] if c and not re.fullmatch(r"[-—– —]*|none|n/?a", c, re.I) else []


_FIELD_CUT = re.compile(r"(?i)(?:[·|]\s*|\s)(?:families?|family|skip-risk|probe|status|reading)\b\s*:?")


def extract_quote(text):
    """The requirement quote of a one-line/one-block record (ledger style)."""
    t = unify_quotes(text or "")
    m = _FIELD_CUT.search(t)
    head = t[: m.start()] if m else t
    first, last = head.find('"'), head.rfind('"')
    if first >= 0 and last > first:
        return head[first + 1:last].strip()
    first, last = t.find('"'), t.rfind('"')
    if first >= 0 and last > first:
        return t[first + 1:last].strip()
    return ""


def strip_html_comments(text):
    """Remove <!-- --> blocks but keep line numbers stable."""
    return re.sub(r"<!--.*?-->", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)


def read_text(path):
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError:
        return None
    text = data.decode("utf-8", errors="replace")
    if text.startswith("﻿"):
        text = text[1:]
    return text.replace("\r\n", "\n").replace("\r", "\n")


def norm_path(p):
    p = clean_cell(p).replace("\\", "/")
    while p.startswith("./"):
        p = p[2:]
    return p


def stage_relative(p):
    """'stage-3/app/x.py' -> 'app/x.py' (so a declaration made for stage 1 matches stage 3)."""
    return re.sub(r"^stage-[^/]+/", "", norm_path(p))


STAGE_PATH = re.compile(r"^stage-[^/]+/")


def under_stage(path):
    return bool(STAGE_PATH.match(norm_path(path)))


# ---------------------------------------------------------------- Markdown records

def split_row(line):
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|") and not s.endswith("\\|"):
        s = s[:-1]
    cells = re.split(r"(?<!\\)\|", s)
    return [c.strip().replace("\\|", "|") for c in cells]


def is_sep_row(line):
    s = line.strip()
    return s.startswith("|") and re.fullmatch(r"\|?(\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*\|?", s) is not None


def is_placeholder(text):
    """Template rows like '| <sibling> | <kind> |' carry no data."""
    t = re.sub(r"<[^>]*>", "", text)
    return not re.sub(r"[|\s·→>-]", "", t)


class Record:
    """One parsed record (ledger item, work item, decision...). Never fatal: raw text is kept."""

    def __init__(self, ident, path, line, text, cells=None, heading=None):
        self.id = ident
        self.path = path
        self.line = line
        self.text = text
        self.cells = cells or {}
        self.heading = heading

    def cell(self, *names):
        """First cell whose header contains any of the names (case-insensitive)."""
        for name in names:
            for header, value in self.cells.items():
                if name in header:
                    return value
        return None

    @property
    def where(self):
        return "%s:%d" % (self.path, self.line)


_LEAD = r"^\s*(?:(?:[-*+>]|\d+[.)])\s+)*[*_`\[]*"


def parse_records(text, path, kind, warn):
    """Forgiving record parser for factory files.
    A record starts at: a table row whose first cell is the id; a heading whose first word is the
    id; or a line/bullet starting with the id. Lines that follow a line/heading record (until a
    blank line, the next record, a heading or a table) belong to it."""
    id_rx = re.compile(ID_PATTERNS[kind])
    text = strip_html_comments(text)
    lines = text.split("\n")
    records = []
    headers = None
    cur = None
    cur_heading_level = None

    def close():
        nonlocal cur
        if cur is not None:
            cur.text = cur.text.rstrip()
            records.append(cur)
        cur = None

    for i, raw in enumerate(lines, 1):
        line = raw.rstrip()
        st = line.strip()
        if st.startswith("|"):
            if is_sep_row(st):
                continue
            cells = split_row(st)
            nxt = lines[i].strip() if i < len(lines) else ""
            if is_sep_row(nxt):
                headers = [clean_cell(c).lower() for c in cells]
                close()
                continue
            first = clean_cell(cells[0]) if cells else ""
            m = id_rx.fullmatch(first) if first else None
            if not m:
                # id may sit in a later cell when a table has no id column first
                m2 = None
                for c in cells[:2]:
                    m2 = id_rx.fullmatch(clean_cell(c))
                    if m2:
                        break
                m = m2
            if m:
                close()
                cmap = {}
                for k, c in enumerate(cells):
                    key = headers[k] if headers and k < len(headers) else "col%d" % k
                    cmap[key] = c
                records.append(Record(m.group(0), path, i, st, cmap))
            elif first and not is_placeholder(st) and find_ids(st, [kind]):
                warn("%s:%d: table row mentions a %s id but does not start with one (kept as raw text)" % (path, i, kind))
            continue
        hm = re.match(r"^(#{1,6})\s+(.*)$", st)
        if hm:
            level = len(hm.group(1))
            body = re.sub(r"^[*_`]+", "", hm.group(2)).strip()
            m = re.match(ID_PATTERNS[kind], body)
            if m:
                close()
                cur = Record(m.group(0), path, i, body, heading=body)
                cur_heading_level = level
                continue
            if cur is not None and (cur_heading_level is None or level <= cur_heading_level):
                close()
            elif cur is not None:
                cur.text += "\n" + st
            continue
        m = re.match(_LEAD + "(" + ID_PATTERNS[kind] + ")", line)
        if m:
            close()
            cur = Record(m.group(1), path, i, st)
            cur_heading_level = None
            continue
        if not st:
            if cur is not None and cur_heading_level is None:
                close()
            elif cur is not None:
                cur.text += "\n"
            continue
        if cur is not None:
            cur.text += "\n" + st
    close()
    return records


def parse_kv(text):
    """'key: value' pairs from loose lines ('**key:** value', '- key: value')."""
    out = {}
    for line in text.split("\n"):
        m = re.match(r"^\s*[-*+]?\s*\**([A-Za-z][A-Za-z0-9 _-]{0,40}?)\**\s*:\**\s*(.*)$", line)
        if m:
            key = m.group(1).strip().lower().replace(" ", "-").replace("_", "-")
            out.setdefault(key, clean_cell(m.group(2)))
    return out


# ---------------------------------------------------------------- git

class GitError(Exception):
    pass


def git(repo, *args, check=True, input_bytes=None, raw=False):
    cmd = ["git", "-C", repo, "-c", "core.quotepath=off"] + list(args)
    env = dict(os.environ)
    env.setdefault("GIT_TERMINAL_PROMPT", "0")
    try:
        p = subprocess.run(cmd, input=input_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    except FileNotFoundError:
        raise GitError("git is not installed or not on PATH")
    if check and p.returncode != 0:
        raise GitError("git %s failed: %s" % (" ".join(args[:3]), p.stderr.decode("utf-8", "replace").strip()))
    if raw:
        return p
    return p.stdout.decode("utf-8", errors="replace")


def find_repo(explicit=None):
    if explicit:
        path = os.path.abspath(explicit)
        try:
            top = git(path, "rev-parse", "--show-toplevel").strip()
            return os.path.normpath(top) if top else path
        except GitError:
            return path
    try:
        top = git(os.getcwd(), "rev-parse", "--show-toplevel").strip()
        if top:
            return os.path.normpath(top)
    except GitError:
        pass
    return None


def resolve_commit(repo, rev):
    p = git(repo, "rev-parse", "--verify", "--quiet", rev + "^{commit}", check=False, raw=True)
    if p.returncode != 0:
        return None
    return p.stdout.decode().strip() or None


def is_ancestor(repo, a, b):
    """True when commit a is b or an ancestor of b."""
    p = git(repo, "merge-base", "--is-ancestor", a, b, check=False, raw=True)
    return p.returncode == 0


def setup_stdout():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
