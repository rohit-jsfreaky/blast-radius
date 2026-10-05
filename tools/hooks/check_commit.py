"""Factory commit rules, called by tools/hooks/pre-commit and tools/hooks/commit-msg.

pre-commit refuses when:
  1. the author is not a seat with a file in mandates/ (a human's commit is allowed only outside stage-*/)
  2. coordinator stages anything outside factory/
  3. verifier or investigator stage anything inside stage-*/
  4. a staged path is a nested repo, a __pycache__/.pyc/node_modules file, or a file over 5 MB
  5. a staged text file has CRLF line endings
commit-msg refuses a commit that touches stage-*/ without Seat:, Work-Item: and Origin: lines
(and a Seat: line that names a different seat than the author).
Standard library only. One line per reason, then exit 1.
"""
import os
import re
import subprocess
import sys

MAX_BYTES = 5 * 1024 * 1024
STAGE = re.compile(r"^stage-[^/]+/")
JUNK = re.compile(r"(^|/)(__pycache__|node_modules)(/|$)|\.py[co]$")
WI_ID = re.compile(r"(?<![A-Za-z0-9_])WI\d+\.\d+(?![A-Za-z0-9_])")
ORIGIN_ID = re.compile(r"(?<![A-Za-z0-9_])(L\d+\.\d+|H\d+\.\d+|F\d+|D\d+|S\d+)(?![A-Za-z0-9_])|\blocal\b", re.I)


def git(*args, input_bytes=None):
    p = subprocess.run(["git", "-c", "core.quotepath=off"] + list(args), input=input_bytes,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return p.returncode, p.stdout


def top():
    rc, out = git("rev-parse", "--show-toplevel")
    return out.decode("utf-8", "replace").strip() if rc == 0 else os.getcwd()


def seats(root):
    d = os.path.join(root, "mandates")
    if not os.path.isdir(d):
        return []
    return sorted(f[:-3] for f in os.listdir(d) if f.lower().endswith(".md") and f.lower() != "readme.md")


def author():
    name = os.environ.get("GIT_AUTHOR_NAME")
    email = os.environ.get("GIT_AUTHOR_EMAIL", "")
    if not name:
        rc, out = git("var", "GIT_AUTHOR_IDENT")
        m = re.match(r"^(.*?)\s*<([^>]*)>", out.decode("utf-8", "replace"))
        if m:
            name, email = m.group(1), m.group(2)
    return (name or "").strip(), (email or "").strip()


def seat_of(name, email, seat_list):
    if name in seat_list:
        return name
    local = email.split("@", 1)[0]
    if local in seat_list and email.endswith("@band.local"):
        return local
    return None


def staged():
    """[(old_mode, new_mode, new_sha, status, path)] for every staged change."""
    rc, out = git("diff", "--cached", "--raw", "-z", "--no-renames", "--no-abbrev")
    entries = []
    parts = out.decode("utf-8", "replace").split("\0")
    i = 0
    while i < len(parts) - 1:
        meta = parts[i]
        if not meta.startswith(":"):
            i += 1
            continue
        f = meta[1:].split()
        path = parts[i + 1]
        entries.append((f[0], f[1], f[3], f[4][:1], path.replace("\\", "/")))
        i += 2
    return entries


def blob_info(shas):
    """sha -> (size, first 8000 bytes have NUL, has CRLF) for blobs up to MAX_BYTES."""
    info = {}
    if not shas:
        return info
    rc, out = git("cat-file", "--batch-check", input_bytes=("\n".join(shas) + "\n").encode())
    sizes = {}
    for line in out.decode().split("\n"):
        p = line.split()
        if len(p) == 3 and p[1] == "blob":
            sizes[p[0]] = int(p[2])
    small = [s for s in shas if sizes.get(s, 0) <= MAX_BYTES and s in sizes]
    if small:
        rc, out = git("cat-file", "--batch", input_bytes=("\n".join(small) + "\n").encode())
        pos = 0
        while pos < len(out):
            nl = out.index(b"\n", pos)
            header = out[pos:nl].decode().split()
            if len(header) < 3:
                break
            size = int(header[2])
            data = out[nl + 1:nl + 1 + size]
            pos = nl + 1 + size + 1
            info[header[0]] = (size, b"\0" in data[:8000], b"\r\n" in data)
    for s in shas:
        if s not in info and s in sizes:
            info[s] = (sizes[s], True, False)
    return info


def pre_commit():
    root = top()
    seat_list = seats(root)
    name, email = author()
    seat = seat_of(name, email, seat_list)
    entries = staged()
    paths = [e[4] for e in entries]
    reasons = []
    stage_paths = [p for p in paths if STAGE.match(p)]
    if seat is None:
        if stage_paths:
            reasons.append("author '%s' is not a seat (mandates/: %s); a human may not commit inside stage-*/ (%s)"
                           % (name, ", ".join(seat_list) or "none", stage_paths[0]))
    elif seat == "coordinator":
        outside = [p for p in paths if not p.startswith("factory/")]
        if outside:
            reasons.append("coordinator may only commit inside factory/ (staged %s)" % outside[0])
    elif seat in ("verifier", "investigator"):
        if stage_paths:
            reasons.append("%s may not commit inside stage-*/ (staged %s)" % (seat, stage_paths[0]))
    live = [e for e in entries if e[3] != "D"]
    for old_mode, new_mode, sha, status, path in live:
        if new_mode == "160000":
            reasons.append("%s is a nested git repository (remove its .git and add the files)" % path)
        elif JUNK.search(path):
            reasons.append("%s is a generated file (__pycache__ / .pyc / node_modules)" % path)
    blobs = [e for e in live if e[1] not in ("160000",) and not set(e[2]) <= {"0"}]
    info = blob_info([e[2] for e in blobs])
    for old_mode, new_mode, sha, status, path in blobs:
        size, binary, crlf = info.get(sha, (0, True, False))
        if size > MAX_BYTES:
            reasons.append("%s is %.1f MB (limit 5 MB)" % (path, size / 1048576.0))
        elif not binary and crlf:
            reasons.append("%s has CRLF line endings (write text files with LF)" % path)
    return reasons


def parse_trailers(text):
    lines = [l for l in text.replace("\r\n", "\n").split("\n") if not l.startswith("#")]
    found = {"seat": [], "work-item": [], "origin": []}
    for l in lines:
        m = re.match(r"^\s*(seat|work[- ]?item|origin)\s*:\s*(.*)$", l, re.I)
        if m:
            key = m.group(1).lower().replace(" ", "-")
            key = "work-item" if key.startswith("work") else key
            found[key].append(m.group(2).strip())
    return found


def commit_msg(msg_file):
    with open(msg_file, "rb") as fh:
        text = fh.read().decode("utf-8", "replace")
    root = top()
    seat_list = seats(root)
    name, email = author()
    seat = seat_of(name, email, seat_list)
    t = parse_trailers(text)
    reasons = []
    paths = [e[4] for e in staged()]
    stage_paths = [p for p in paths if STAGE.match(p)]
    if t["seat"] and seat and t["seat"][0] != seat:
        reasons.append("'Seat: %s' does not match the author seat '%s'" % (t["seat"][0], seat))
    if stage_paths:
        if not any(v for v in t["seat"]):
            reasons.append("touches stage-*/ (%s) without a 'Seat:' line" % stage_paths[0])
        if not any(WI_ID.search(v) for v in t["work-item"]):
            reasons.append("touches stage-*/ (%s) without a 'Work-Item: WI<s>.<n>' line" % stage_paths[0])
        if not any(ORIGIN_ID.search(v) for v in t["origin"]):
            reasons.append("touches stage-*/ (%s) without an 'Origin:' line naming L/F/H/D/S ids" % stage_paths[0])
        owners = workitem_owners(root)
        if owners is not None and seat:
            for v in t["work-item"]:
                for wi in WI_ID.findall(v):
                    if wi not in owners:
                        reasons.append("%s is not in factory/workitems.md (ask the coordinator to add it first)" % wi)
                    elif owners[wi] != seat:
                        reasons.append("%s belongs to %s in factory/workitems.md, not to %s: name the work item "
                                       "these lines implement" % (wi, owners[wi], seat))
    return reasons


def workitem_owners(root):
    """{WI id: owner seat} from the rows of factory/workitems.md, or None when it has no rows."""
    path = os.path.join(root, "factory", "workitems.md")
    try:
        with open(path, "rb") as fh:
            text = fh.read().decode("utf-8", "replace")
    except OSError:
        return None
    owners = {}
    for line in text.replace("\r\n", "\n").split("\n"):
        m = re.match(r"^\s*\|?\s*\**(WI\d+\.\d+)\**\s*\|\s*@?([\w-]+)", line)
        if m and m.group(1) not in owners:
            owners[m.group(1)] = m.group(2)
    return owners or None


def main(argv):
    if not argv:
        print("check_commit.py: usage: check_commit.py pre-commit | commit-msg <file>", file=sys.stderr)
        return 2
    if argv[0] == "pre-commit":
        reasons = pre_commit()
    elif argv[0] == "commit-msg" and len(argv) > 1:
        reasons = commit_msg(argv[1])
    else:
        print("check_commit.py: unknown hook %s" % argv[0], file=sys.stderr)
        return 2
    for r in reasons:
        print("%s: refused: %s" % (argv[0], r), file=sys.stderr)
    return 1 if reasons else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
