"""Load a result repository into one origin graph. Parse problems become warnings, never errors."""
import glob
import json
import os
import re

from . import util
from .util import (ANY_ID, Record, clean_cell, extract_quote, find_ids, norm, norm_path,
                   parse_kv, parse_records, read_text, split_quotes, strip_outer_quotes, unify_quotes)

PROBE_EXTS = {".py", ".sh", ".bash", ".js", ".mjs", ".cjs", ".ts", ".ps1", ".cmd", ".bat", ".rb", ".pl"}
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", ".pytest_cache"}


def _ids_outside_quotes(text, kinds):
    t = re.sub(r'"[^"]*"', " ", unify_quotes(text or ""))
    return find_ids(t, kinds)


def _seats_in(text, seats):
    found = []
    for s in seats:
        if re.search(r"(?<![\w-])@?" + re.escape(s) + r"(?![\w-])", text or ""):
            found.append(s)
    return found


class Graph:
    def __init__(self, repo):
        self.repo = repo
        self.warnings = []
        self.seats = []
        self.ledger = {}
        self.families = {}
        self.workitems = {}
        self.handoffs = {}
        self.decisions = {}
        self.shared = {}
        self.commits = []          # newest first
        self.commit_by_sha = {}
        self.incidents = {}
        self.probes = {}
        self.regression = []
        self._wi_covers = None

    # ------------------------------------------------------------ helpers
    def warn(self, msg):
        self.warnings.append(msg)

    def rel(self, path):
        return norm_path(os.path.relpath(path, self.repo))

    def path(self, *parts):
        return os.path.join(self.repo, *parts)

    def exists(self, ident):
        kind = util.id_kind(ident)
        table = {"L": self.ledger, "F": self.families, "WI": self.workitems, "H": self.handoffs,
                 "D": self.decisions, "S": self.shared, "INC": self.incidents}.get(kind)
        return table is not None and ident in table

    # ------------------------------------------------------------ load
    def load(self, with_git=True):
        self._load_seats()
        self._load_ledger()
        self._load_families()
        self._load_workitems()
        self._load_handoffs()
        self._load_decisions()
        self._load_shared()
        if with_git:
            self._load_commits()
        self._load_incidents()
        self._load_probes()
        return self

    def _load_seats(self):
        d = self.path("mandates")
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if f.lower().endswith(".md") and f.lower() != "readme.md":
                    self.seats.append(f[:-3])

    def _file_records(self, relpath, kind):
        full = self.path(*relpath.split("/"))
        text = read_text(full)
        if text is None:
            return []
        return parse_records(text, relpath, kind, self.warn)

    def _load_ledger(self):
        files = sorted(glob.glob(self.path("ledger", "*.md")))
        for full in files:
            if os.path.basename(full).lower() == "readme.md":
                continue
            rel = self.rel(full)
            m = re.search(r"stage-(\d+)", os.path.basename(full))
            text = read_text(full) or ""
            for r in parse_records(text, rel, "L", self.warn):
                after = r.text[len(r.id):] if r.text.startswith(r.id) else r.text
                is_reading = re.match(r"^[\s*_`·|:-]*reading\b", after, re.I) is not None and not r.cells
                if is_reading:
                    item = self.ledger.get(r.id)
                    if item is None:
                        self.warn("%s: reading for %s comes before the item itself" % (r.where, r.id))
                        item = self._new_ledger(r, m)
                        self.ledger[r.id] = item
                    item["readings"].append(after.strip(" :*_`·|-"))
                    continue
                if r.id in self.ledger:
                    self.warn("%s: duplicate ledger id %s (first at %s); texts merged" % (r.where, r.id, self.ledger[r.id]["where"]))
                    self.ledger[r.id]["text"] += "\n" + r.text
                    continue
                self.ledger[r.id] = self._new_ledger(r, m)

    def _new_ledger(self, r, stage_match):
        if r.cells:
            qcell = r.cell("quote", "requirement", "text")
            quote = strip_outer_quotes(qcell) if qcell else extract_quote(r.text)
            fcell = r.cell("famil")
            fams = find_ids(fcell, ["F"]) if fcell is not None else _ids_outside_quotes(r.text, ["F"])
            pcell = r.cell("probe")
            probe = norm_path(pcell) if pcell else ""
            scell = r.cell("status")
            status = clean_cell(scell) if scell else ""
        else:
            quote = extract_quote(r.text)
            fams = _ids_outside_quotes(r.text, ["F"])
            pm = re.search(r"(?i)\bprobe\s*:\s*`?([^\s`·|]+)", r.text)
            probe = norm_path(pm.group(1)) if pm else ""
            sm = re.search(r"(?i)\bstatus\s*:\s*([^·|\n]+)", r.text)
            status = clean_cell(sm.group(1)) if sm else ""
        if not quote:
            self.warn("%s: ledger item %s has no quoted requirement text" % (r.where, r.id))
        stage = stage_match.group(1) if stage_match else re.match(r"L(\d+)", r.id).group(1)
        return {"id": r.id, "stage": int(stage), "quote": quote, "families": fams,
                "skip_risk": bool(re.search(r"(?i)skip[- ]risk", r.text)) and not re.search(r"(?i)no[t]? skip[- ]risk", r.text),
                "probe": probe, "status": status, "readings": [], "text": r.text, "where": r.where}

    def _load_families(self):
        for r in self._file_records("factory/families.md", "F"):
            body = r.text
            first = body.split("\n", 1)[0]
            rule = re.sub(r"^" + re.escape(r.id) + r"[\s*_`]*[—–:\-|.]*\s*", "", first).strip()
            kv = parse_kv(body)
            fam = {"id": r.id, "rule": clean_cell(rule) or clean_cell(r.cell("rule") or ""),
                   "quotes": [q for q in re.findall(r'"([^"]+)"', unify_quotes(body))],
                   "ledger": find_ids(body, ["L"]), "shared": find_ids(body, ["S"]),
                   "cards": sorted(set("INC-" + n for n in util.INC_RE.findall(body))),
                   "places": kv.get("places", ""), "text": body, "where": r.where}
            if r.id in self.families:
                self.warn("%s: duplicate family id %s" % (r.where, r.id))
                continue
            self.families[r.id] = fam

    def _load_workitems(self):
        for r in self._file_records("factory/workitems.md", "WI"):
            if r.cells:
                owner = clean_cell(r.cell("owner") or "")
                qc = r.cell("quote", "requirement")
                quotes = split_quotes(qc) if qc is not None else re.findall(r'"([^"]+)"', unify_quotes(r.text))
                fc, cc, hc = r.cell("famil"), r.cell("change", "earlier"), r.cell("handoff")
                fams = find_ids(fc, ["F"]) if fc is not None else _ids_outside_quotes(r.text, ["F"])
                changes = [w for w in find_ids(cc, ["WI"]) if w != r.id] if cc is not None else []
                hand = find_ids(hc, ["H"]) if hc is not None else _ids_outside_quotes(r.text, ["H"])
            else:
                seats = _seats_in(r.text, self.seats)
                om = re.search(r"(?i)\bowner\s*:\s*@?([\w-]+)", r.text)
                owner = om.group(1) if om else (seats[0] if seats else "")
                quotes = re.findall(r'"([^"]+)"', unify_quotes(r.text))
                fams = _ids_outside_quotes(r.text, ["F"])
                changes = [w for w in _ids_outside_quotes(r.text, ["WI"]) if w != r.id]
                hand = _ids_outside_quotes(r.text, ["H"])
            owner = owner.lstrip("@")
            if not quotes:
                self.warn("%s: work item %s has no quoted requirement text" % (r.where, r.id))
            if r.id in self.workitems:
                self.warn("%s: duplicate work item %s" % (r.where, r.id))
                continue
            self.workitems[r.id] = {"id": r.id, "owner": owner, "quotes": quotes, "families": fams,
                                    "changes": changes, "handoffs": hand,
                                    "ledger": _ids_outside_quotes(r.text, ["L"]),
                                    "decisions": _ids_outside_quotes(r.text, ["D"]),
                                    "shared": _ids_outside_quotes(r.text, ["S"]),
                                    "text": r.text, "where": r.where}

    def _load_handoffs(self):
        d = self.path("factory", "handoffs")
        if not os.path.isdir(d):
            return
        for f in sorted(os.listdir(d)):
            m = re.match(r"^(H\d+\.\d+)(?![\d])", f)
            if not m or not f.lower().endswith((".md", ".txt")):
                if f.lower() not in ("readme.md",) and f.lower().endswith(".md"):
                    self.warn("factory/handoffs/%s: file name does not start with an H<s>.<n> id (ignored)" % f)
                continue
            full = os.path.join(d, f)
            text = read_text(full) or ""
            hid = m.group(1)
            if hid in self.handoffs:
                self.handoffs[hid]["text"] += "\n" + text
                self.handoffs[hid]["files"].append(self.rel(full))
            else:
                self.handoffs[hid] = {"id": hid, "text": text, "files": [self.rel(full)], "where": self.rel(full) + ":1"}
        for h in self.handoffs.values():
            h["workitems"] = find_ids(h["text"], ["WI"])
            h["owner"] = ""
            for s in self.seats:
                if re.search(r"@" + re.escape(s) + r"(?![\w-])", h["text"]):
                    if s not in ("coordinator",):
                        h["owner"] = s
                        break

    def _load_decisions(self):
        for r in self._file_records("factory/decisions.md", "D"):
            if r.cells:
                seat = clean_cell(r.cell("seat", "who") or "").lstrip("@")
                choice = clean_cell(r.cell("choice", "decision") or "")
                qc = r.cell("quote", "requirement")
                quote = strip_outer_quotes(qc) if qc else ""
                dc = r.cell("depend")
                deps = [i for i in find_ids(dc or "") if i != r.id]
                deps_raw = clean_cell(dc or "")
            else:
                seats = _seats_in(r.text, self.seats)
                seat = seats[0] if seats else ""
                quote = extract_quote(r.text)
                choice = ""
                cm = re.search(r"(?i)\bchoice\s*:\s*([^·|\n]+)", r.text)
                if cm:
                    choice = clean_cell(cm.group(1))
                deps = [i for i in _ids_outside_quotes(r.text, None) if i != r.id]
                dm = re.search(r"(?i)\bdepends?(?: on it)?\s*:\s*(.*)", r.text)
                deps_raw = clean_cell(dm.group(1)) if dm else ""
            if r.id in self.decisions:
                self.warn("%s: duplicate decision %s" % (r.where, r.id))
                continue
            self.decisions[r.id] = {"id": r.id, "seat": seat, "choice": choice, "quote": quote,
                                    "dependents": deps, "dependents_raw": deps_raw, "text": r.text, "where": r.where}

    def _load_shared(self):
        for r in self._file_records("factory/shared.md", "S"):
            if r.cells:
                fs = r.cell("file", "symbol") or ""
                guarantee = clean_cell(r.cell("guarantee") or "")
                fc = r.cell("famil")
                fams = find_ids(fc, ["F"]) if fc is not None else _ids_outside_quotes(r.text, ["F"])
                owner = clean_cell(r.cell("owner") or "").lstrip("@")
                cons = r.cell("consumer") or ""
            else:
                m = re.search(r"([\w@./\\-]+\.[A-Za-z0-9]+\s*(?:::|:|#)\s*[A-Za-z_$][\w$.]*)", r.text)
                fs = m.group(1) if m else ""
                gm = re.search(r"(?i)\bguarantee\s*:\s*([^·|\n]+)", r.text)
                guarantee = clean_cell(gm.group(1)) if gm else ""
                fams = _ids_outside_quotes(r.text, ["F"])
                seats = _seats_in(r.text, self.seats)
                om = re.search(r"(?i)\bowner\s*:\s*@?([\w-]+)", r.text)
                owner = om.group(1) if om else (seats[0] if seats else "")
                cm = re.search(r"(?i)\bconsumers?\s*:\s*(.*)", r.text)
                cons = cm.group(1) if cm else ""
            parts = self._split_file_symbol(fs)
            fpath, symbol = parts[0][0], (parts[0][1][0] if parts[0][1] else "")
            consumers = self._parse_consumers(cons)
            if r.id in self.shared:
                self.warn("%s: duplicate shared-code id %s" % (r.where, r.id))
                continue
            if not symbol:
                self.warn("%s: shared code %s names no symbol (file : symbol)" % (r.where, r.id))
            self.shared[r.id] = {"id": r.id, "file": fpath, "symbol": symbol, "parts": parts,
                                 "symbols": [x for _, ss in parts for x in ss], "guarantee": guarantee,
                                 "families": fams, "owner": owner, "consumers": consumers,
                                 "consumers_raw": clean_cell(cons), "text": r.text, "where": r.where}

    @staticmethod
    def _split_file_symbol(fs):
        """'file : sym' or 'a.py : x, y(args); b.py : z' -> [(file, [symbols])]. Arguments in
        parentheses are dropped; names may be separated by commas or slashes."""
        out = []
        for part in re.split(r";|<br\s*/?>", clean_cell(fs)):
            part = part.strip().strip("`").strip()
            if not part:
                continue
            m = re.match(r"^`?(.*?)`?\s*(?:::|:|#|\s—\s|\s-\s)\s*(.+)$", part)
            if not (m and ("/" in m.group(1) or "." in m.group(1) or "\\" in m.group(1))):
                out.append((norm_path(part), []))
                continue
            rest = m.group(2)
            while re.search(r"\([^()]*\)", rest):
                rest = re.sub(r"\([^()]*\)", "", rest)
            syms = []
            for tok in re.split(r"[,/]", rest):
                tm = re.match(r"^\s*`?([A-Za-z_$][\w$.]*)", tok)
                if tm:
                    name = tm.group(1).split(".")[-1]
                    if name not in syms:
                        syms.append(name)
            out.append((norm_path(m.group(1)), syms))
        return out or [(norm_path(fs), [])]

    def _parse_consumers(self, text):
        out = []
        text = clean_cell(text or "")
        if not text or re.fullmatch(r"(?i)[-—– ]*|none|n/?a|tbd", text):
            return out
        for tok in re.split(r"[,;]\s*|\s+and\s+|<br\s*/?>", text):
            tok = clean_cell(tok)
            if not tok:
                continue
            pm = re.search(r"([\w@.\\/-]+\.[A-Za-z0-9]{1,6}|[\w@.-]+/[\w@./\\-]+)", tok)
            path = norm_path(pm.group(1)) if pm else ""
            if path and re.fullmatch(r"(WI|L|H)\d+\.\d+", path):
                path = ""
            wis = find_ids(tok, ["WI"])
            seats = _seats_in(tok, self.seats)
            out.append({"raw": tok, "path": path, "workitems": wis, "seat": seats[0] if seats else ""})
        return out

    def _load_commits(self):
        p = util.git(self.repo, "rev-parse", "--verify", "--quiet", "HEAD", check=False, raw=True)
        if p.returncode != 0:
            return
        out = util.git(self.repo, "log", "--no-renames", "--name-only",
                       "--format=%x1e%H%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%B%x1f", "HEAD")
        for chunk in out.split("\x1e"):
            if not chunk.strip():
                continue
            parts = chunk.split("\x1f")
            if len(parts) < 7:
                continue
            sha, an, ae, date, parents, body, names = parts[:7]
            files = [norm_path(n) for n in names.split("\n") if n.strip()]
            c = {"sha": sha, "author": an, "email": ae, "date": date, "parents": parents.split(),
                 "subject": body.strip().split("\n", 1)[0] if body.strip() else "", "files": files}
            c.update(parse_trailers(body))
            self.commits.append(c)
            self.commit_by_sha[sha] = c

    def _load_incidents(self):
        d = self.path("incidents")
        if not os.path.isdir(d):
            return
        for f in sorted(os.listdir(d), key=lambda x: [int(n) for n in re.findall(r"\d+", x)] or [0]):
            if not re.fullmatch(r"INC-\d+\.md", f):
                continue
            card = parse_card(os.path.join(d, f), "incidents/" + f, self.warn)
            self.incidents[card["id"]] = card

    def _load_probes(self):
        root = self.path("checks")
        if not os.path.isdir(root):
            return
        all_files = set()
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [x for x in dirnames if x not in SKIP_DIRS]
            for f in filenames:
                all_files.add(norm_path(os.path.relpath(os.path.join(dirpath, f), self.repo)))
        for rel in sorted(all_files):
            base = os.path.basename(rel)
            if base.lower() in ("readme.md", "regression.txt") or base.endswith(".calibration.json"):
                continue
            ext = os.path.splitext(base)[1].lower()
            cal_path = find_calibration(self.repo, rel)
            if ext not in PROBE_EXTS and not cal_path:
                continue
            cal = load_calibration(self.repo, cal_path) if cal_path else None
            calibrated = bool(cal and cal.get("bad_result") == "FAIL" and cal.get("status", "calibrated") != "uncalibrated"
                              and cal.get("bad_target"))
            self.probes[rel] = {"path": rel, "calibration": cal_path or "", "calibrated": calibrated,
                                "bad_result": (cal or {}).get("bad_result", ""), "good_result": (cal or {}).get("good_result", "")}
        reg = read_text(self.path("checks", "regression.txt"))
        if reg:
            for line in reg.split("\n"):
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                m = re.search(r"([\w@.\\/-]+\.[A-Za-z0-9]{1,6}|[\w@.-]+/[\w@./\\-]+)", line)
                if m:
                    self.regression.append(norm_path(m.group(1)))

    # ------------------------------------------------------------ derived
    def wi_covers(self):
        """WI id -> set of L ids it covers (explicit id, overlapping quote, or tagged commits)."""
        if self._wi_covers is not None:
            return self._wi_covers
        cov = {w: set(wi["ledger"]) for w, wi in self.workitems.items()}
        lq = {lid: norm(item["quote"]) for lid, item in self.ledger.items() if item["quote"]}
        for w, wi in self.workitems.items():
            for q in wi["quotes"]:
                nq = norm(q)
                if len(nq) < 8:
                    continue
                for lid, l in lq.items():
                    if len(l) >= 8 and (l in nq or nq in l):
                        cov[w].add(lid)
        for c in self.commits:
            for w in c["workitems"]:
                if w in cov:
                    cov[w].update(o for o in c["origins"] if o.startswith("L"))
        self._wi_covers = cov
        return cov

    def handoffs_of(self, wid):
        hs = list(self.workitems.get(wid, {}).get("handoffs", []))
        for hid, h in self.handoffs.items():
            if wid in h["workitems"] and hid not in hs:
                hs.append(hid)
        return hs

    def stage_commits(self):
        return [c for c in self.commits if any(util.under_stage(f) for f in c["files"])]

    def current_stage_dir(self):
        best = None
        for name in os.listdir(self.repo):
            m = re.fullmatch(r"stage-(\d+)", name)
            if m and os.path.isdir(self.path(name)):
                if best is None or int(m.group(1)) > best[0]:
                    best = (int(m.group(1)), name)
        return best[1] if best else None

    def orphans(self):
        out = []
        for c in self.stage_commits():
            missing = []
            if not c["workitems"]:
                missing.append("Work-Item:")
            if not c["has_origin"]:
                missing.append("Origin:")
            if missing:
                out.append({"kind": "commit", "id": c["sha"], "reason": "touches stage-*/ without " + " and ".join(missing),
                            "where": c["sha"][:12] + " " + c["subject"][:60]})
        for w, wi in sorted(self.workitems.items(), key=lambda kv: util.id_sort_key(kv[0])):
            if not self.handoffs_of(w):
                out.append({"kind": "WI", "id": w, "reason": "no handoff carries this work item", "where": wi["where"]})
        for d, dec in sorted(self.decisions.items(), key=lambda kv: util.id_sort_key(kv[0])):
            if not dec["quote"]:
                out.append({"kind": "D", "id": d, "reason": "decision quotes no requirement text", "where": dec["where"]})
        for s, sh in sorted(self.shared.items(), key=lambda kv: util.id_sort_key(kv[0])):
            if not sh["consumers"]:
                out.append({"kind": "S", "id": s, "reason": "shared code lists no consumers", "where": sh["where"]})
        return out

    def counts(self):
        return {"ledger (L)": len(self.ledger), "families (F)": len(self.families),
                "work items (WI)": len(self.workitems), "handoffs (H)": len(self.handoffs),
                "decisions (D)": len(self.decisions), "shared code (S)": len(self.shared),
                "commits": len(self.commits), "commits under stage-*/": len(self.stage_commits()),
                "incidents (INC)": len(self.incidents), "probes": len(self.probes)}

    def edges(self):
        e = []
        for lid, l in self.ledger.items():
            e += [(lid, f, "in-family") for f in l["families"]]
        for fid, f in self.families.items():
            e += [(lid, fid, "in-family") for lid in f["ledger"]]
            e += [(s, fid, "implements") for s in f["shared"]]
        for w, wi in self.workitems.items():
            e += [(w, f, "in-family") for f in wi["families"]]
            e += [(w, h, "handed-off-in") for h in self.handoffs_of(w)]
            e += [(w, x, "changes") for x in wi["changes"]]
            e += [(w, lid, "covers") for lid in sorted(self.wi_covers().get(w, ()))]
        for d, dec in self.decisions.items():
            e += [(x, d, "depends-on") for x in dec["dependents"]]
        for s, sh in self.shared.items():
            e += [(s, f, "implements") for f in sh["families"]]
            for c in sh["consumers"]:
                e.append((c["path"] or c["raw"], s, "consumes"))
        for c in self.commits:
            e += [(c["sha"], w, "work-item") for w in c["workitems"]]
            e += [(c["sha"], o, "origin") for o in c["origins"]]
        for i, card in self.incidents.items():
            if card["origin"].get("id"):
                e.append((i, card["origin"]["id"], "born-from"))
        seen, out = set(), []
        for a, b, k in e:
            if (a, b, k) not in seen:
                seen.add((a, b, k))
                out.append({"from": a, "to": b, "kind": k})
        return out

    def to_json(self):
        strip = lambda d: {k: v for k, v in d.items() if k != "text"}
        return {"repo": self.repo, "counts": self.counts(), "orphans": self.orphans(),
                "nodes": {"L": [strip(x) for x in self.ledger.values()],
                          "F": [strip(x) for x in self.families.values()],
                          "WI": [strip(x) for x in self.workitems.values()],
                          "H": [{"id": h["id"], "files": h["files"], "workitems": h["workitems"], "owner": h["owner"]} for h in self.handoffs.values()],
                          "D": [strip(x) for x in self.decisions.values()],
                          "S": [strip(x) for x in self.shared.values()],
                          "commits": [{k: c[k] for k in ("sha", "author", "date", "subject", "seat", "workitems", "origins", "origin_raw", "files")} for c in self.commits],
                          "INC": [{k: v for k, v in c.items() if k not in ("text", "ids")} for c in self.incidents.values()],
                          "probes": list(self.probes.values())},
                "edges": self.edges(), "warnings": self.warnings}


# ---------------------------------------------------------------- trailers

_TRAILER = re.compile(r"(?im)^[ \t]*(seat|work[- ]?item|origin)[ \t]*:[ \t]*(.*)$")


def parse_trailers(body):
    seat, wis, origins, raw = "", [], [], []
    has_wi = has_origin = False
    for key, value in _TRAILER.findall(body or ""):
        k = key.lower().replace(" ", "-")
        v = value.strip()
        if k == "seat":
            seat = seat or clean_cell(v)
        elif k.startswith("work"):
            for w in find_ids(v, ["WI"]):
                if w not in wis:
                    wis.append(w)
        else:
            if v:
                raw.append(v)
                ids = find_ids(v, list(util.ORIGIN_KINDS))
                origins += [i for i in ids if i not in origins]
                if ids or re.search(r"(?i)\blocal\b", v):
                    has_origin = True
    return {"seat": seat, "workitems": wis, "origins": origins, "origin_raw": "; ".join(raw),
            "has_origin": has_origin}


# ---------------------------------------------------------------- incident cards

def parse_card(full, rel, warn):
    text = read_text(full) or ""
    lines = text.split("\n")
    m = re.search(r"INC-(\d+)", os.path.basename(full))
    card = {"id": "INC-" + m.group(1), "number": int(m.group(1)), "path": rel, "title": "",
            "fields": {}, "origin": {}, "siblings": [], "close": {}, "text": text, "lines": {}}
    section = ""
    headers = None
    for i, raw in enumerate(lines, 1):
        st = raw.strip()
        hm = re.match(r"^(#{1,6})\s+(.*)$", st)
        if hm:
            title = clean_cell(hm.group(2))
            if len(hm.group(1)) == 1 and not card["title"]:
                card["title"] = title
            else:
                section = title.lower()
            headers = None
            continue
        if st.startswith("|"):
            if util.is_sep_row(st):
                continue
            cells = util.split_row(st)
            nxt = lines[i].strip() if i < len(lines) else ""
            if util.is_sep_row(nxt):
                headers = [clean_cell(c).lower() for c in cells]
                continue
            if headers and any("sibling" in h for h in headers) and not util.is_placeholder(st):
                row = {"line": i, "raw": st}
                for k, c in enumerate(cells):
                    h = headers[k] if k < len(headers) else "col%d" % k
                    for key, needles in (("sibling", ("sibling",)), ("kind", ("kind",)), ("owner", ("owner",)),
                                         ("probe", ("probe",)), ("calibrated", ("calibrat", "known-bad")),
                                         ("result", ("result",)), ("action", ("action",))):
                        if any(n in h for n in needles) and key not in row:
                            row[key] = c.strip()
                card["siblings"].append(row)
            continue
        kv = re.match(r"^\s*[-*+]?\s*\**([A-Za-z][A-Za-z0-9 _-]{0,30}?)\**\s*:\**\s*(.*)$", st)
        if kv:
            key = kv.group(1).strip().lower().replace(" ", "-").replace("_", "-")
            val = clean_cell(kv.group(2))
            if "origin" in section and key in ("kind", "id", "quote", "traced", "why-this-origin", "family-rule"):
                if key not in card["origin"]:
                    card["origin"][key] = strip_outer_quotes(val) if key == "quote" else val
                    card["lines"]["origin." + key] = i
            elif "close" in section:
                card["close"].setdefault(key, val)
                card["lines"].setdefault("close." + key, i)
            else:
                if key not in card["fields"]:
                    card["fields"][key] = val
                    card["lines"][key] = i
    f = card["fields"]
    st0 = re.match(r"[A-Za-z]+", f.get("status", ""))
    card["status"] = st0.group(0).lower() if st0 else ""
    sm = re.search(r"\d+", f.get("stage", ""))
    card["stage"] = int(sm.group(0)) if sm else None
    o = card["origin"]
    kind = clean_cell(o.get("kind", ""))
    km = re.match(r"(?i)(local|[LFHDS])(?![A-Za-z])", kind)
    if km:
        o["kind"] = "local" if km.group(1).lower() == "local" else km.group(1).upper()
    else:
        o["kind"] = kind
    ids = find_ids(o.get("id", ""))
    o["id"] = ids[0] if ids else clean_cell(o.get("id", ""))
    for key in ("defect-commit", "fix-commit"):
        hm2 = util.HASH_RE.search(f.get(key, "").lower())
        card[key.replace("-", "_")] = hm2.group(0) if hm2 else ""
    if not card["status"]:
        warn("%s: card has no status line" % rel)
    if not o.get("kind"):
        warn("%s: card has no origin kind" % rel)
    return card


# ---------------------------------------------------------------- calibrations

def calibration_candidates(rel):
    base, _ext = os.path.splitext(rel)
    return [rel + ".calibration.json", base + ".calibration.json"]


def find_calibration(repo, rel):
    for c in calibration_candidates(rel):
        if os.path.isfile(os.path.join(repo, *c.split("/"))):
            return c
    return ""


def load_calibration(repo, rel):
    try:
        with open(os.path.join(repo, *rel.split("/")), "r", encoding="utf-8-sig") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None
