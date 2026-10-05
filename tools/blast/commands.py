"""The six blast commands: graph, origin, family, card check, calibrate, report."""
import datetime
import io
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time

from . import util
from .graph import (SKIP_DIRS, Graph, find_calibration, load_calibration, parse_card)
from .util import contains_verbatim, find_ids, id_kind, id_sort_key, norm_path, stage_relative

# ====================================================================== graph

def cmd_graph(g, as_json=False, strict=False):
    orphans = g.orphans()
    if as_json:
        print(json.dumps(g.to_json(), indent=2))
    else:
        print("blast graph  %s" % g.repo)
        for k, v in g.counts().items():
            print("  %-26s %d" % (k, v))
        print("orphans: %d" % len(orphans))
        for o in orphans:
            print("  ORPHAN %-7s %-14s %s  (%s)" % (o["kind"], o["id"][:14], o["reason"], o["where"]))
    return 1 if (strict and orphans) else 0


# ====================================================================== origin

DEF_RE = re.compile(r"^(\s*)(?:export\s+)?(?:default\s+)?(?:pub(?:\([^)]*\))?\s+)?(?:static\s+)?(?:async\s+)?"
                    r"(?:def|function\*?|class|fn|func|sub|const|let|var|interface|type)\s+([A-Za-z_$][\w$]*)")
ARROW_RE = re.compile(r"^(\s*)(?:export\s+)?(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?"
                      r"(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)")
METHOD_RE = re.compile(r"^(\s*)(?:async\s+)?(?:static\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{")


def enclosing_symbols(lines, lineno):
    """Names of the definitions that enclose 1-based lineno, innermost first."""
    out = []
    if not (1 <= lineno <= len(lines)):
        return out
    tgt = lines[lineno - 1].expandtabs(4)
    min_ind = len(tgt) - len(tgt.lstrip()) if tgt.strip() else 10 ** 6
    for idx in range(lineno - 1, -1, -1):
        line = lines[idx].expandtabs(4)
        if not line.strip():
            continue
        ind = len(line) - len(line.lstrip())
        m = DEF_RE.match(line) or ARROW_RE.match(line) or METHOD_RE.match(line)
        if m and (idx == lineno - 1 or ind < min_ind):
            if m.group(2) not in ("if", "for", "while", "switch", "catch", "return"):
                out.append(m.group(2))
            min_ind = ind
            if ind == 0:
                break
            continue
        if ind < min_ind and not re.match(r"^\s*([})\]@#*]|//|/\*|else\b|elif\b|except\b|finally\b|catch\b)", line):
            min_ind = ind
            if ind == 0 and idx != lineno - 1:
                break
    return out


def _resolve_path(g, path):
    p = path.replace("\\", "/")
    if os.path.isabs(p):
        return norm_path(os.path.relpath(p, g.repo))
    if os.path.exists(os.path.join(g.repo, *p.split("/"))):
        return norm_path(p)
    cand = os.path.abspath(p)
    if os.path.exists(cand):
        return norm_path(os.path.relpath(cand, g.repo))
    return norm_path(p)


_BLAME_CACHE = {}


def blame_file(repo, rel, rev=None):
    """[(sha, original path, original line, content)] per line, from ONE whole-file
    `git blame -w -C -C --line-porcelain`. Whole file on purpose: git's copy detection needs a
    block of text, so `-L n,n` on a copied stage folder would wrongly blame the copy commit."""
    key = (repo, rel, rev)
    if key in _BLAME_CACHE:
        return _BLAME_CACHE[key]
    args = ["blame", "-w", "-C", "-C", "--line-porcelain"]
    if rev:
        args.append(rev)
    args += ["--", rel]
    p = util.git(repo, *args, check=False, raw=True)
    rows = []
    if p.returncode == 0:
        cur = None
        for l in p.stdout.decode("utf-8", "replace").split("\n"):
            if cur is None:
                head = l.split()
                if len(head) >= 3 and re.fullmatch(r"[0-9a-f]{40}", head[0]):
                    cur = [head[0], rel, int(head[1])]
                continue
            if l.startswith("filename "):
                cur[1] = norm_path(l[9:])
            elif l.startswith("\t"):
                rows.append((cur[0], cur[1], cur[2], l[1:]))
                cur = None
    _BLAME_CACHE[key] = rows
    return rows


def blame_line(repo, rel, lineno, rev=None):
    """(sha, original path, original line, content) for one line, or None."""
    rows = blame_file(repo, rel, rev)
    if 1 <= lineno <= len(rows):
        return rows[lineno - 1]
    return None


def _describe(g, ident):
    k = id_kind(ident)
    if k == "L" and ident in g.ledger:
        l = g.ledger[ident]
        return '"%s" | families %s | %s' % (l["quote"], ",".join(l["families"]) or "-", l["where"])
    if k == "F" and ident in g.families:
        f = g.families[ident]
        return '%s | %s' % (f["rule"], f["where"])
    if k == "D" and ident in g.decisions:
        d = g.decisions[ident]
        return '%s | "%s" | %s' % (d["choice"], d["quote"], d["where"])
    if k == "S" and ident in g.shared:
        s = g.shared[ident]
        return '%s : %s | %s | families %s | %s' % (s["file"], s["symbol"], s["guarantee"], ",".join(s["families"]) or "-", s["where"])
    if k == "H" and ident in g.handoffs:
        return ", ".join(g.handoffs[ident]["files"])
    if k == "WI" and ident in g.workitems:
        w = g.workitems[ident]
        return 'owner %s | "%s" | %s' % (w["owner"] or "-", " / ".join(w["quotes"]), w["where"])
    return "NOT FOUND in the factory files"


def shared_containing(g, rel, lineno):
    """[(S id, strong)] for shared code declared in this file; strong when the line is inside the symbol."""
    out = []
    full = os.path.join(g.repo, *rel.split("/"))
    text = util.read_text(full)
    syms = enclosing_symbols(text.split("\n"), lineno) if text is not None else []
    for sid, s in sorted(g.shared.items(), key=lambda kv: id_sort_key(kv[0])):
        hit = None
        for f, ss in s.get("parts") or [(s["file"], [s["symbol"]] if s["symbol"] else [])]:
            if f and (norm_path(f) == rel or stage_relative(f) == stage_relative(rel)):
                strong = [x for x in ss if x in syms]
                if hit is None or (strong and not hit[1]):
                    hit = (sid, bool(strong), syms)
        if hit:
            out.append(hit)
    return out


def trace(g, path_line=None, commit=None):
    hops, origins = [], []

    def hop(kind, ident, detail, evidence=""):
        hops.append({"hop": kind, "id": ident, "detail": detail, "evidence": evidence})

    sha = None
    rel = lineno = None
    if commit:
        sha = util.resolve_commit(g.repo, commit)
        if not sha:
            hop("error", commit, "no such commit")
            return hops, origins
    else:
        m = re.match(r"^(.*):(\d+)$", path_line or "")
        if not m:
            hop("error", path_line or "", "expected <path>:<line>")
            return hops, origins
        rel, lineno = _resolve_path(g, m.group(1)), int(m.group(2))
        b = blame_line(g.repo, rel, lineno)
        if not b:
            hop("error", "%s:%d" % (rel, lineno), "git blame found nothing (file not tracked, or line out of range)")
            return hops, origins
        sha, opath, oline, content = b
        hop("line", "%s:%d" % (rel, lineno), content.strip()[:100], "git blame -w -C -C")
        if set(sha) == {"0"}:
            hop("blame", "uncommitted", "this line is not committed yet")
            sha = None
        else:
            hop("blame", sha, "introduced at %s:%d" % (opath, oline), "git blame -w -C -C")
    if sha:
        c = g.commit_by_sha.get(sha)
        if not c:
            hop("commit", sha, "not on HEAD's history (trailers not read)")
        else:
            hop("commit", sha, "author %s | Seat: %s | Work-Item: %s | Origin: %s | %s" % (
                c["author"], c["seat"] or "-", ",".join(c["workitems"]) or "MISSING",
                c["origin_raw"] or "MISSING", c["subject"][:60]), sha[:12])
            for w in c["workitems"]:
                hop("work-item", w, _describe(g, w), g.workitems.get(w, {}).get("where", ""))
                for h in g.handoffs_of(w):
                    hop("handoff", h, _describe(g, h))
            for o in c["origins"]:
                hop("origin", o, _describe(g, o))
                if o not in origins:
                    origins.append(o)
    if rel:
        for sid, strong, syms in shared_containing(g, rel, lineno):
            if strong:
                inside = [x for x in g.shared[sid].get("symbols", []) if x in syms] or [g.shared[sid]["symbol"]]
                hop("shared", sid, "line %d is inside %s, declared shared code: %s" % (lineno, inside[0], _describe(g, sid)), "factory/shared.md")
                if sid not in origins:
                    origins.append(sid)
            else:
                hop("shared?", sid, "same file as shared code %s : %s, but the line is inside %s" % (
                    g.shared[sid]["file"], g.shared[sid]["symbol"], ", ".join(syms) or "no definition"), "factory/shared.md")
    for o in list(origins):
        fams = []
        if o.startswith("L") and o in g.ledger:
            fams = g.ledger[o]["families"]
        elif o.startswith("S") and o in g.shared:
            fams = g.shared[o]["families"]
        for f in fams:
            if f not in origins:
                hop("family", f, _describe(g, f))
                origins.append(f)
    return hops, origins


def cmd_origin(g, path_line=None, commit=None, as_json=False):
    hops, origins = trace(g, path_line, commit)
    if as_json:
        print(json.dumps({"hops": hops, "origins": origins}, indent=2))
    else:
        for h in hops:
            ev = ("   [%s]" % h["evidence"]) if h["evidence"] else ""
            print("%-10s %-14s %s%s" % (h["hop"], h["id"][:14] if h["hop"] in ("commit", "blame") else h["id"], h["detail"], ev))
        print("origins: %s" % (" ".join(origins) if origins else "none found"))
    return 0 if not any(h["hop"] == "error" for h in hops) else 1


# ====================================================================== family

def _row(kind, ident, owner="", files=(), quote="", via="", flag=""):
    return {"kind": kind, "id": ident, "owner": owner, "files": sorted(set(files)), "quote": quote, "via": via, "flag": flag}


def _commit_row(c, via):
    return _row("commit", c["sha"], c["seat"] or c["author"], c["files"], c["subject"], via)


def _file_rows(commits, via_prefix="touched by"):
    files = {}
    for c in commits:
        for f in c["files"]:
            if util.under_stage(f):
                files.setdefault(f, []).append(c["sha"][:8])
    return [_row("file", f, "", [f], "", "%s %s" % (via_prefix, ",".join(v[:3]))) for f, v in sorted(files.items())]


def family_rows(g, ident):
    kind = id_kind(ident)
    rows = []
    if kind == "L":
        l = g.ledger.get(ident)
        if not l:
            return None
        rows.append(_row("L", ident, "", [], l["quote"], "origin"))
        cov = g.wi_covers()
        wis = [w for w, ls in cov.items() if ident in ls]
        for w in sorted(wis, key=id_sort_key):
            wi = g.workitems[w]
            rows.append(_row("WI", w, wi["owner"], [], " / ".join(wi["quotes"]), "covers " + ident))
        commits = [c for c in g.commits if ident in c["origins"] or set(c["workitems"]) & set(wis)]
        rows += [_commit_row(c, "Origin " + ident if ident in c["origins"] else "Work-Item " + ",".join(set(c["workitems"]) & set(wis))) for c in commits]
        rows += _file_rows(commits)
        for other, o in sorted(g.ledger.items(), key=lambda kv: id_sort_key(kv[0])):
            shared = set(o["families"]) & set(l["families"])
            if other != ident and shared:
                rows.append(_row("L", other, "", [], o["quote"], "sibling sentence (same family %s)" % ",".join(sorted(shared)),
                                 "skip-risk" if o["skip_risk"] else ""))
        return rows
    if kind == "F":
        f = g.families.get(ident)
        if not f:
            return None
        rows.append(_row("F", ident, "", [], f["rule"], "origin"))
        members_l = sorted({lid for lid, l in g.ledger.items() if ident in l["families"]} | set(x for x in f["ledger"] if x in g.ledger), key=id_sort_key)
        for lid in members_l:
            rows.append(_row("L", lid, "", [], g.ledger[lid]["quote"], "in family", "skip-risk" if g.ledger[lid]["skip_risk"] else ""))
        cov = g.wi_covers()
        wis = sorted({w for w, wi in g.workitems.items() if ident in wi["families"] or cov.get(w, set()) & set(members_l)}, key=id_sort_key)
        for w in wis:
            wi = g.workitems[w]
            rows.append(_row("WI", w, wi["owner"], [], " / ".join(wi["quotes"]), "in family" if ident in wi["families"] else "covers a member sentence"))
        shs = sorted({s for s, sh in g.shared.items() if ident in sh["families"]} | set(x for x in f["shared"] if x in g.shared), key=id_sort_key)
        for s in shs:
            sh = g.shared[s]
            rows.append(_row("S", s, sh["owner"], [sh["file"]], sh["guarantee"], "implements " + ident))
        member_ids = {ident} | set(members_l) | set(shs)
        commits = [c for c in g.commits if set(c["origins"]) & member_ids or set(c["workitems"]) & set(wis)]
        rows += [_commit_row(c, "Origin " + ",".join(sorted(set(c["origins"]) & member_ids)) if set(c["origins"]) & member_ids
                             else "Work-Item " + ",".join(sorted(set(c["workitems"]) & set(wis)))) for c in commits]
        rows += _file_rows(commits)
        return rows
    if kind == "H":
        h = g.handoffs.get(ident)
        if not h:
            return None
        rows.append(_row("H", ident, h["owner"], h["files"], "", "origin"))
        wis = sorted({w for w in g.workitems if ident in g.handoffs_of(w)} | set(x for x in h["workitems"] if x in g.workitems), key=id_sort_key)
        missing_wi = [x for x in h["workitems"] if x not in g.workitems]
        for w in wis:
            wi = g.workitems[w]
            rows.append(_row("WI", w, wi["owner"], [], " / ".join(wi["quotes"]), "carried by " + ident))
            for q in wi["quotes"]:
                if not contains_verbatim(h["text"], q):
                    rows.append(_row("loss", w, wi["owner"], h["files"], q, "quoted requirement of %s" % w,
                                     "HANDOFF LOSS: not verbatim in %s" % ident))
        for w in missing_wi:
            rows.append(_row("WI", w, "", [], "", "named in handoff", "not in the work-items file"))
        commits = [c for c in g.commits if set(c["workitems"]) & set(wis)]
        rows += [_commit_row(c, "Work-Item " + ",".join(sorted(set(c["workitems"]) & set(wis)))) for c in commits]
        rows += _file_rows(commits)
        return rows
    if kind == "D":
        d = g.decisions.get(ident)
        if not d:
            return None
        rows.append(_row("D", ident, d["seat"], [], d["quote"], "origin: " + d["choice"][:60]))
        commits = [c for c in g.commits if ident in c["origins"]]
        rows += [_commit_row(c, "Origin " + ident) for c in commits]
        for w, wi in sorted(g.workitems.items(), key=lambda kv: id_sort_key(kv[0])):
            if ident in wi["decisions"]:
                rows.append(_row("WI", w, wi["owner"], [], " / ".join(wi["quotes"]), "lists " + ident))
        for x in d["dependents"]:
            rows.append(_row(id_kind(x) or "?", x, "", [], "", "declared dependent of " + ident,
                             "" if g.exists(x) else "unknown id"))
        if d["dependents_raw"] and not d["dependents"]:
            rows.append(_row("dependent", d["dependents_raw"][:40], "", [], "", "declared dependent (no id)"))
        rows += _file_rows(commits)
        return rows
    if kind == "S":
        s = g.shared.get(ident)
        if not s:
            return None
        rows.append(_row("S", ident, s["owner"], [s["file"]], s["guarantee"], "origin: %s : %s" % (s["file"], s["symbol"])))
        declared_paths, declared_wis = set(), set()
        for c in s["consumers"]:
            if c["path"]:
                declared_paths.add(stage_relative(c["path"]))
            declared_wis.update(c["workitems"])
            rows.append(_row("consumer", c["path"] or c["raw"], c["seat"], [c["path"]] if c["path"] else [], "",
                             "declared consumer" + (" " + ",".join(c["workitems"]) if c["workitems"] else "")))
        wi_files = set()
        for c in g.commits:
            if set(c["workitems"]) & declared_wis:
                wi_files.update(stage_relative(f) for f in c["files"])
        stage = g.current_stage_dir()
        parts = s.get("parts") or [(s["file"], [s["symbol"]] if s["symbol"] else [])]
        if not any(ss for _, ss in parts):
            rows.append(_row("note", ident, "", [], "", "", "no symbol declared: cannot search for undeclared consumers"))
        elif stage:
            own = {stage_relative(f) for f, _ in parts if f}
            seen = set()
            for f, ss in parts:
                for sym in ss:
                    for ref in referencing_files(g.repo, stage, sym):
                        srel = stage_relative(ref)
                        if (srel, sym) in seen:
                            continue
                        seen.add((srel, sym))
                        if srel == stage_relative(f):
                            rows.append(_row("file", ref, "", [ref], "", "defines " + sym))
                            continue
                        if srel in own:
                            continue
                        declared = (srel in declared_paths or any(not "/" in p and os.path.basename(srel) == p for p in declared_paths)
                                    or srel in wi_files)
                        rows.append(_row("file", ref, "", [ref], "", "references " + sym,
                                         "" if declared else "UNDECLARED consumer (not in factory/shared.md)"))
        commits = [c for c in g.commits if ident in c["origins"]]
        rows += [_commit_row(c, "Origin " + ident) for c in commits]
        return rows
    if kind == "WI":
        wi = g.workitems.get(ident)
        if not wi:
            return None
        rows.append(_row("WI", ident, wi["owner"], [], " / ".join(wi["quotes"]), "origin"))
        origins = []
        for c in g.commits:
            if ident in c["workitems"]:
                origins += c["origins"]
        origins += sorted(g.wi_covers().get(ident, ())) + wi["families"] + wi["decisions"] + wi["shared"]
        seen = []
        for o in origins:
            if o not in seen:
                seen.append(o)
        fams = []
        for o in seen:
            if g.exists(o):
                rows.append(_row(id_kind(o), o, "", [], _describe(g, o)[:120], "origin of " + ident))
            fl = [o] if o.startswith("F") else (g.ledger.get(o, {}).get("families", []) if o.startswith("L")
                                                else g.shared.get(o, {}).get("families", []) if o.startswith("S") else [])
            fams += [f for f in fl if f not in fams]
        have = {(r["kind"], r["id"]) for r in rows}
        for f in fams:
            for r in family_rows(g, f) or []:
                if (r["kind"], r["id"]) not in have:
                    have.add((r["kind"], r["id"]))
                    r["via"] = "family %s: %s" % (f, r["via"])
                    rows.append(r)
        return rows
    return None


TEXT_EXTS_SKIP = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".pdf",
                  ".zip", ".gz", ".tar", ".db", ".sqlite", ".pyc", ".lock", ".map"}


def referencing_files(repo, stage, symbol):
    rx = re.compile(r"(?<![\w$])" + re.escape(symbol) + r"(?![\w$])")
    out = []
    root = os.path.join(repo, stage)
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".") and d not in ("dist", "build"))
        for f in sorted(filenames):
            if os.path.splitext(f)[1].lower() in TEXT_EXTS_SKIP:
                continue
            full = os.path.join(dirpath, f)
            try:
                if os.path.getsize(full) > 2 * 1024 * 1024:
                    continue
                with open(full, "rb") as fh:
                    data = fh.read()
            except OSError:
                continue
            if b"\0" in data[:8000]:
                continue
            if rx.search(data.decode("utf-8", "replace")):
                out.append(norm_path(os.path.relpath(full, repo)))
    return out


def cmd_family(g, ident, as_json=False):
    rows = family_rows(g, ident)
    if rows is None:
        print("blast family: %s is not a known L/F/H/D/S/WI id in this repository" % ident, file=sys.stderr)
        return 1
    flags = [r for r in rows if r["flag"]]
    if as_json:
        print(json.dumps({"id": ident, "rows": rows, "flags": len(flags)}, indent=2))
        return 0
    print("blast family %s   (%d rows, %d flagged)" % (ident, len(rows), len(flags)))
    print("%-9s %-14s %-12s %-34s %-40s %s" % ("kind", "id", "owner", "files", "quote / via", "flag"))
    for r in rows:
        ident_s = r["id"][:12] if r["kind"] == "commit" else r["id"]
        files = ", ".join(r["files"])
        if len(files) > 34:
            files = files[:31] + "..."
        q = r["quote"].replace("\n", " ")
        text = (('"%s" ' % (q[:60] + ("..." if len(q) > 60 else ""))) if q else "") + ("(%s)" % r["via"] if r["via"] else "")
        print("%-9s %-14s %-12s %-34s %-40s %s" % (r["kind"], ident_s, (r["owner"] or "")[:12], files, text, r["flag"]))
    return 0


# ====================================================================== card check

ROW_REJECT = re.compile(r"(?i)\bREJECT\b")


def _quote_sources(g, kind, ident, spec_files):
    """Texts in which the card's origin quote must appear verbatim."""
    out = []
    if kind == "L" and ident in g.ledger:
        out.append(("ledger " + ident, g.ledger[ident]["text"] + "\n" + g.ledger[ident]["quote"]))
    elif kind == "F" and ident in g.families:
        out.append(("family " + ident, g.families[ident]["text"]))
        for lid, l in g.ledger.items():
            if ident in l["families"]:
                out.append(("ledger " + lid, l["text"]))
    elif kind == "H" and ident in g.handoffs:
        out.append(("handoff " + ident, g.handoffs[ident]["text"]))
    elif kind == "D" and ident in g.decisions:
        out.append(("decision " + ident, g.decisions[ident]["text"]))
    elif kind == "S" and ident in g.shared:
        s = g.shared[ident]
        out.append(("shared " + ident, s["text"]))
        files = []
        for f, _ in s.get("parts") or [(s["file"], [])]:
            if f and f not in files:
                files.append(f)
        for f in files:
            src = util.read_text(os.path.join(g.repo, *f.split("/")))
            if src is None:
                stage = g.current_stage_dir()
                if stage:
                    src = util.read_text(os.path.join(g.repo, stage, *stage_relative(f).split("/")))
            if src:
                out.append(("source " + f, src))
    for sf in spec_files:
        t = util.read_text(sf)
        if t:
            out.append(("spec " + sf, t))
    return out


def _hunks(repo, sha):
    """[(path_in_parent, old_start, old_count)] for a commit against its first parent."""
    p = util.git(repo, "show", "--format=", "--no-renames", "-U0", "--no-color", sha, check=False, raw=True)
    out, path = [], None
    for line in p.stdout.decode("utf-8", "replace").split("\n"):
        if line.startswith("--- "):
            path = None if line[4:].strip() == "/dev/null" else norm_path(line[4:].strip()[2:] if line[4:].startswith("a/") else line[4:].strip())
        m = re.match(r"^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@", line)
        if m and path:
            out.append((path, int(m.group(1)), int(m.group(2)) if m.group(2) is not None else 1))
    return out


def fix_touches_defect(repo, fix, defect):
    """Does the fix change (or insert right next to) lines that blame attributes to the defect commit?"""
    seen = set()
    hunks = _hunks(repo, fix)
    for path, start, count in hunks:
        lines = range(start, start + count) if count > 0 else [n for n in (start, start + 1) if n >= 1]
        for n in lines:
            b = blame_line(repo, path, n, rev=fix + "^")
            if b:
                seen.add(b[0])
                if b[0].startswith(defect) or defect.startswith(b[0]):
                    return True, seen
    return False, seen


def _strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _strings(v)


def card_check(g, card_path, room=None, spec_files=()):
    fails = []
    full = os.path.abspath(card_path)
    if not os.path.isfile(full):
        alt = os.path.join(g.repo, "incidents", os.path.basename(card_path))
        full = alt if os.path.isfile(alt) else os.path.join(g.repo, card_path)
    if not os.path.isfile(full):
        return ["%s: no such card" % card_path]
    rel = norm_path(os.path.relpath(full, g.repo))
    card = parse_card(full, rel, g.warn)
    L = card["lines"]
    at = lambda key: "%s:%d" % (rel, L.get(key, 1))

    # 1. every id it cites exists
    for n, line in enumerate(card["text"].split("\n"), 1):
        for ident in find_ids(line):
            if not g.exists(ident):
                fails.append("%s:%d: cites %s, which is not in the graph" % (rel, n, ident))
        for num in util.INC_RE.findall(line):
            inc = "INC-" + num
            if inc != card["id"] and inc not in g.incidents:
                fails.append("%s:%d: cites %s, which has no card in incidents/" % (rel, n, inc))

    # 2. origin quote verbatim
    o = card["origin"]
    kind, oid, quote = o.get("kind", ""), o.get("id", ""), o.get("quote", "")
    if kind not in ("L", "F", "H", "D", "S", "local"):
        fails.append("%s: origin kind '%s' is not one of L F H D S local" % (at("origin.kind"), kind))
    elif kind != "local":
        if not oid or id_kind(oid) != kind:
            fails.append("%s: origin id '%s' is not a %s id" % (at("origin.id"), oid, kind))
        elif not g.exists(oid):
            pass  # reported by check 1
        if not quote:
            fails.append("%s: origin quote is empty" % at("origin.quote"))
        elif g.exists(oid):
            sources = _quote_sources(g, kind, oid, spec_files)
            if not any(contains_verbatim(t, quote) for _, t in sources):
                fails.append('%s: origin quote is not verbatim in %s: "%s"' % (
                    at("origin.quote"), " / ".join(n for n, _ in sources) or oid, quote[:80]))

    # 3. defect and fix commits
    defect, fix = card["defect_commit"], card["fix_commit"]
    dsha = util.resolve_commit(g.repo, defect) if defect else None
    fsha = util.resolve_commit(g.repo, fix) if fix else None
    if not defect:
        fails.append("%s: defect-commit is missing" % at("defect-commit"))
    elif not dsha:
        fails.append("%s: defect-commit %s does not exist" % (at("defect-commit"), defect))
    if not fix:
        fails.append("%s: fix-commit is missing" % at("fix-commit"))
    elif not fsha:
        fails.append("%s: fix-commit %s does not exist" % (at("fix-commit"), fix))
    if dsha and fsha:
        if not util.is_ancestor(g.repo, dsha, fsha):
            fails.append("%s: fix-commit %s is not after defect-commit %s" % (at("fix-commit"), fsha[:12], dsha[:12]))
        else:
            ok, seen = fix_touches_defect(g.repo, fsha, dsha)
            if not ok:
                fails.append("%s: fix-commit %s does not touch lines that git blame gives to defect-commit %s (blame found %s)" % (
                    at("fix-commit"), fsha[:12], dsha[:12], ", ".join(s[:12] for s in sorted(seen)) or "nothing"))

    # 4. sibling rows: probe exists + calibrated
    sibs = card["siblings"]
    if kind in ("L", "F", "H", "D", "S") and not sibs:
        fails.append("%s: origin kind %s but the sweep table has no sibling rows" % (rel, kind))
    failing_rows = []
    for r in sibs:
        where = "%s:%d" % (rel, r["line"])
        probe = norm_path(re.sub(r"[`*]", "", r.get("probe", "")).split()[0]) if r.get("probe", "").strip() else ""
        r["probe_path"] = probe
        if not probe:
            fails.append("%s: sibling '%s' has no probe" % (where, r.get("sibling", "?")))
            continue
        if not os.path.isfile(os.path.join(g.repo, *probe.split("/"))):
            fails.append("%s: probe %s does not exist" % (where, probe))
            continue
        cal_rel = find_calibration(g.repo, probe)
        cal = load_calibration(g.repo, cal_rel) if cal_rel else None
        if not cal:
            fails.append("%s: probe %s has no calibration record (%s.calibration.json)" % (where, probe, probe))
        elif cal.get("bad_result") != "FAIL" or cal.get("status") == "uncalibrated":
            fails.append("%s: probe %s is uncalibrated: it did not FAIL on the known-bad (%s -> %s)" % (
                where, probe, cal.get("bad_target", "?"), cal.get("bad_result", "?")))
        elif not str(cal.get("bad_target", "")).strip():
            fails.append("%s: probe %s calibration names no known-bad target" % (where, probe))
        r["cal"] = cal
        row_cal = r.get("calibrated", "")
        if (not row_cal.strip() or util.is_placeholder(row_cal) or row_cal.strip() in ("—", "–", "n/a")
                or re.search(r"(?i)\b(not\s+(?:\w+\s+)?calibrated|uncalibrated|already\s+passed|still\s+pass(?:ed|es)?|no\s+planted|did\s+not\s+take|checks?\s+only)", row_cal)):
            fails.append("%s: sibling '%s' is not calibrated for this row (the calibrated-on cell names no known-bad "
                         "this probe failed on): a probe that never failed cannot clear a sibling" % (where, r.get("sibling", "?")))
        if re.search(r"\bFAIL", r.get("result", "")) or ROW_REJECT.search(r.get("action", "")):
            failing_rows.append(r)

    # 5. closed => every failing sibling fixed and later PASS
    if card["status"] == "closed":
        for r in failing_rows:
            where = "%s:%d" % (rel, r["line"])
            m = re.search(r"(?i)FIXED\s*`?([0-9a-f]{7,40})", r.get("action", ""))
            sfix = util.resolve_commit(g.repo, m.group(1)) if m else None
            if not m:
                fails.append("%s: card is closed but failing sibling '%s' has no 'FIXED <hash>'" % (where, r.get("sibling", "?")))
                continue
            if not sfix:
                fails.append("%s: sibling fix commit %s does not exist" % (where, m.group(1)))
                continue
            cal = r.get("cal") or {}
            history = cal.get("history") or [cal]
            ok = False
            for h in history:
                if h.get("good_result") != "PASS":
                    continue
                rev = h.get("good_rev") or h.get("git_rev") or ""
                if rev and util.resolve_commit(g.repo, rev) and util.is_ancestor(g.repo, sfix, rev):
                    ok = True
                    break
            if not ok:
                fails.append("%s: no PASS record for probe %s on the sibling fix %s or later (run blast calibrate with --good at or after the fix)" % (
                    where, r.get("probe_path", "?"), sfix[:12]))
    elif card["status"] != "open":
        fails.append("%s: status '%s' is neither open nor closed" % (at("status"), card["status"] or "missing"))

    # 6. room messages
    if room:
        try:
            with open(room, "r", encoding="utf-8-sig") as fh:
                data = json.load(fh)
            strings = list(_strings(data))
        except (OSError, ValueError) as e:
            fails.append("room %s: cannot read (%s)" % (room, e))
            strings = None
        if strings is not None:
            for n, line in enumerate(card["text"].split("\n"), 1):
                for rid in util.REJECT_ID_RE.findall(line):
                    rx = re.compile(r"(?<![\w.])" + re.escape(rid) + r"(?![\w]|\.\d)")
                    if not any("REJECT" in s and rx.search(s) for s in strings):
                        fails.append("%s:%d: REJECT %s is not in the room log" % (rel, n, rid))
                for hid in find_ids(line, ["H"]):
                    rx = re.compile(r"(?<![\w.])" + re.escape(hid) + r"(?![\w]|\.\d)")
                    if not any("HANDOFF" in s and rx.search(s) for s in strings):
                        fails.append("%s:%d: HANDOFF %s is not in the room log" % (rel, n, hid))
    # de-duplicate, keep order
    seen, out = set(), []
    for f in fails:
        if f not in seen:
            seen.add(f)
            out.append(f)
    return out


def cmd_card_check(g, cards, room=None, spec_files=()):
    rc = 0
    for c in cards:
        fails = card_check(g, c, room, spec_files)
        if fails:
            rc = 1
            for f in fails:
                print(f)
        else:
            print("%s: card ok" % c if len(cards) > 1 else "card ok")
    return rc


# ====================================================================== calibrate

def _find_sh():
    sh = shutil.which("sh")
    if sh:
        return sh
    try:
        p = subprocess.run(["git", "--exec-path"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        root = os.path.normpath(os.path.join(p.stdout.decode().strip(), "..", "..", ".."))
        for cand in (os.path.join(root, "bin", "sh.exe"), os.path.join(root, "usr", "bin", "sh.exe")):
            if os.path.isfile(cand):
                return cand
    except OSError:
        pass
    return None


def probe_command(probe):
    ext = os.path.splitext(probe)[1].lower()
    if ext == ".py":
        return [sys.executable, probe]
    if ext in (".sh", ".bash"):
        sh = _find_sh()
        return [sh, probe] if sh else None
    if ext in (".js", ".mjs", ".cjs"):
        node = shutil.which("node")
        return [node, probe] if node else None
    if ext == ".ts":
        npx = shutil.which("npx")
        return [npx, "--yes", "tsx", probe] if npx else None
    if ext == ".ps1":
        ps = shutil.which("pwsh") or shutil.which("powershell")
        return [ps, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", probe] if ps else None
    if ext in (".cmd", ".bat"):
        return ["cmd", "/c", probe]
    if ext == ".rb":
        return [shutil.which("ruby") or "ruby", probe]
    if ext == ".pl":
        return [shutil.which("perl") or "perl", probe]
    return [probe] if os.access(probe, os.X_OK) else None


def classify(rc, output, timed_out=False):
    if timed_out:
        return "ERROR"
    if re.search(r"\bFAIL(?:ED|URE|S)?\b", output):
        return "FAIL"
    if rc != 0:
        return "ERROR"
    if re.search(r"\bPASS(?:ED|ES)?\b", output):
        return "PASS"
    return "ERROR"


def _kill_tree(proc):
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except OSError:
            proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def _materialise(repo, target):
    """-> (kind, dir_or_None, resolved_rev_or_None, cleanup_dir_or_None)"""
    if re.match(r"^https?://", target):
        return "url", None, None, None
    cand = target if os.path.isabs(target) else os.path.join(os.getcwd(), target)
    if os.path.isdir(cand):
        return "folder", os.path.abspath(cand), None, None
    alt = os.path.join(repo, target)
    if os.path.isdir(alt):
        return "folder", os.path.abspath(alt), None, None
    sha = util.resolve_commit(repo, target)
    if sha:
        tmp = tempfile.mkdtemp(prefix="blast-rev-")
        p = util.git(repo, "archive", "--format=tar", sha, raw=True, check=False)
        if p.returncode == 0:
            with tarfile.open(fileobj=io.BytesIO(p.stdout)) as tf:
                try:
                    tf.extractall(tmp, filter="data")
                except TypeError:
                    tf.extractall(tmp)
        return "rev", tmp, sha, tmp
    return "unknown", None, None, None


def run_against(repo, probe_abs, target, role, start=None, wait=3.0, timeout=300.0, url=None):
    kind, tdir, sha, cleanup = _materialise(repo, target)
    env = dict(os.environ)
    env.update({"BLAST_TARGET": target, "BLAST_TARGET_KIND": kind, "BLAST_TARGET_DIR": tdir or "",
                "BLAST_ROLE": role, "BLAST_REPO": repo, "BLAST_URL": url or (target if kind == "url" else "")})
    server = None
    try:
        if kind == "unknown":
            return {"target": target, "kind": kind, "result": "ERROR", "rev": None,
                    "output": "target is not a folder, a git revision or a URL"}
        if start:
            cmd = start.replace("{dir}", tdir or "").replace("{url}", env["BLAST_URL"])
            kw = {"start_new_session": True} if os.name != "nt" else {"creationflags": getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)}
            server = subprocess.Popen(cmd, shell=True, cwd=tdir or repo, env=env,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kw)
            time.sleep(wait)
        cmd = probe_command(probe_abs)
        if not cmd or not cmd[0]:
            return {"target": target, "kind": kind, "result": "ERROR", "rev": sha,
                    "output": "no interpreter found for %s" % os.path.basename(probe_abs)}
        arg = env["BLAST_URL"] or tdir or target
        try:
            p = subprocess.run(cmd + [arg], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env,
                               cwd=os.path.dirname(probe_abs), timeout=timeout)
            out = p.stdout.decode("utf-8", "replace")
            res = classify(p.returncode, out)
            rc = p.returncode
        except subprocess.TimeoutExpired as e:
            out = (e.stdout or b"").decode("utf-8", "replace") + "\n[timed out after %ss]" % timeout
            res, rc = "ERROR", None
        tail = "\n".join(out.strip().split("\n")[-20:])
        return {"target": target, "kind": kind, "result": res, "rev": sha, "exit": rc, "output": tail}
    finally:
        if server is not None:
            _kill_tree(server)
        if cleanup:
            shutil.rmtree(cleanup, ignore_errors=True)


def cmd_calibrate(g, probe, bad, good=None, start=None, wait=3.0, timeout=300.0, bad_url=None, good_url=None):
    rel = _resolve_path(g, probe)
    probe_abs = os.path.join(g.repo, *rel.split("/"))
    if not os.path.isfile(probe_abs):
        print("blast calibrate: no such probe %s" % probe, file=sys.stderr)
        return 2
    b = run_against(g.repo, probe_abs, bad, "bad", start, wait, timeout, bad_url)
    gd = run_against(g.repo, probe_abs, good, "good", start, wait, timeout, good_url) if good else None
    head = util.resolve_commit(g.repo, "HEAD") or ""
    now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    status = "calibrated" if b["result"] == "FAIL" else "uncalibrated"
    entry = {"probe": rel, "bad_target": bad, "bad_kind": b["kind"], "bad_rev": b["rev"], "bad_result": b["result"],
             "good_target": good or "", "good_kind": gd["kind"] if gd else "", "good_rev": gd["rev"] if gd else None,
             "good_result": gd["result"] if gd else "", "time": now, "git_rev": head, "status": status,
             "bad_output": b["output"], "good_output": gd["output"] if gd else ""}
    cal_rel = rel + ".calibration.json"
    cal_abs = os.path.join(g.repo, *cal_rel.split("/"))
    old = load_calibration(g.repo, cal_rel) if os.path.isfile(cal_abs) else None
    history = (old or {}).get("history") or ([{k: v for k, v in old.items() if k != "history"}] if old else [])
    history.append({k: v for k, v in entry.items() if k not in ("bad_output", "good_output")})
    record = dict(entry)
    record["history"] = history
    with open(cal_abs, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(record, fh, indent=2)
        fh.write("\n")
    print("%s: %s | bad %s -> %s | good %s -> %s | %s" % (
        rel, status, bad, b["result"], good or "-", gd["result"] if gd else "-", cal_rel))
    if status == "uncalibrated":
        print("  the probe did not FAIL on the known-bad, so it proves nothing yet. Last output:")
        for line in b["output"].split("\n")[-5:]:
            print("    " + line)
    return 0 if status == "calibrated" else 1


# ====================================================================== report

def _sib_class(r):
    res, act = r.get("result", ""), r.get("action", "")
    failing = bool(re.search(r"\bFAIL", res)) or bool(ROW_REJECT.search(act))
    checked = bool(re.search(r"\b(PASS|FAIL)", res)) or failing
    fixed = failing and bool(re.search(r"(?i)FIXED\s*`?[0-9a-f]{7,40}", act))
    cleared = (not failing) and (bool(re.search(r"(?i)CLEARED", act)) or bool(re.search(r"\bPASS", res)))
    return checked, failing, fixed, cleared


def card_family_key(g, card):
    o = card["origin"]
    ids = set()
    if o.get("id"):
        ids.add(o["id"])
        oid = o["id"]
        if oid in g.ledger:
            ids.update(g.ledger[oid]["families"])
        if oid in g.shared:
            ids.update(g.shared[oid]["families"])
    return ids


def build_report(g):
    cards = sorted(g.incidents.values(), key=lambda c: c["number"])
    per_stage, kinds = {}, {k: 0 for k in ("L", "F", "H", "D", "S", "local")}
    tot = {"checked": 0, "failing": 0, "fixed": 0, "cleared": 0}
    rows, recurrences = [], []
    for c in cards:
        st = str(c["stage"]) if c["stage"] is not None else "unknown"
        per_stage[st] = per_stage.get(st, 0) + 1
        k = c["origin"].get("kind") or "unknown"
        kinds[k] = kinds.get(k, 0) + 1
        s = {"checked": 0, "failing": 0, "fixed": 0, "cleared": 0}
        for r in c["siblings"]:
            ch, fa, fi, cl = _sib_class(r)
            s["checked"] += ch
            s["failing"] += fa
            s["fixed"] += fi
            s["cleared"] += cl
        for key in tot:
            tot[key] += s[key]
        fam = card_family_key(g, c)
        rec = None
        if fam and not re.search(r"(?i)\bsweep\b", c["fields"].get("found-by", "")):
            for earlier in cards:
                if earlier["number"] >= c["number"]:
                    break
                if earlier["status"] == "closed" and card_family_key(g, earlier) & fam:
                    rec = earlier["id"]
                    break
        if rec:
            recurrences.append({"card": c["id"], "family_already_closed_in": rec})
        rows.append({"id": c["id"], "stage": c["stage"], "status": c["status"], "origin_kind": k,
                     "origin_id": c["origin"].get("id", ""), "found_by": c["fields"].get("found-by", ""),
                     "family_size": len(c["siblings"]), "siblings_checked": s["checked"],
                     "siblings_failing": s["failing"], "fixed": s["fixed"], "cleared": s["cleared"],
                     "recurrence_of": rec})
    probes = list(g.probes.values())
    reg_stage = {}
    for p in g.regression:
        m = re.search(r"stage-(\d+)", p)
        if m:
            st = m.group(1)
        else:
            mi = re.search(r"INC-(\d+)", p)
            card = g.incidents.get("INC-" + mi.group(1)) if mi else None
            st = str(card["stage"]) if card and card["stage"] is not None else "unknown"
        reg_stage[st] = reg_stage.get(st, 0) + 1
    return {
        "incidents": {"total": len(cards), "per_stage": dict(sorted(per_stage.items())),
                      "open": sum(1 for c in cards if c["status"] == "open"),
                      "closed": sum(1 for c in cards if c["status"] == "closed")},
        "origin_kinds": kinds,
        "family_size": {"per_incident": {r["id"]: r["family_size"] for r in rows},
                        "total": sum(r["family_size"] for r in rows),
                        "max": max([r["family_size"] for r in rows] or [0])},
        "siblings": {"checked": tot["checked"], "failing_found_by_sweep": tot["failing"],
                     "fixed": tot["fixed"], "cleared": tot["cleared"]},
        "recurrence": {"count": len(recurrences), "cases": recurrences},
        "probes": {"total": len(probes), "calibrated": sum(1 for p in probes if p["calibrated"]),
                   "uncalibrated": sum(1 for p in probes if not p["calibrated"]),
                   "regression_set": {"total": len(g.regression), "per_stage": dict(sorted(reg_stage.items()))}},
        "cards": rows,
    }


def cmd_report(g, as_json=False):
    r = build_report(g)
    if as_json:
        print(json.dumps(r, indent=2))
        return 0
    i, s, p = r["incidents"], r["siblings"], r["probes"]
    print("incidents: %d (open %d, closed %d) | per stage %s" % (i["total"], i["open"], i["closed"],
          ", ".join("%s:%d" % kv for kv in i["per_stage"].items()) or "-"))
    print("origin kinds: " + ", ".join("%s %d" % kv for kv in r["origin_kinds"].items()))
    print("family size per incident: " + (", ".join("%s %d" % kv for kv in r["family_size"]["per_incident"].items()) or "-"))
    print("siblings checked %d | failing found by the sweep %d | fixed %d | cleared %d" % (
        s["checked"], s["failing_found_by_sweep"], s["fixed"], s["cleared"]))
    print("recurrence after a closed card: %d%s" % (r["recurrence"]["count"], "".join(
        "  (%s, family closed in %s)" % (x["card"], x["family_already_closed_in"]) for x in r["recurrence"]["cases"])))
    print("probes: %d total, %d calibrated, %d uncalibrated | regression set %d (%s)" % (
        p["total"], p["calibrated"], p["uncalibrated"], p["regression_set"]["total"],
        ", ".join("stage %s:%d" % kv for kv in p["regression_set"]["per_stage"].items()) or "-"))
    return 0
