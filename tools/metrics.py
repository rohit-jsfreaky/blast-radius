"""Every number the README and FACTORY.md print, from files in this repo.

python tools/metrics.py  ->  evidence/metrics.json  (and a short summary on stdout)
Sources: git history, room.json, evidence/holdout/stage-*/holdout.json,
evidence/stage-*/official-*/report.json, `python -m blast report --json`.
"""
import collections
import glob
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def git(*args):
    return subprocess.run(["git", "-C", ROOT] + list(args), capture_output=True, text=True,
                          encoding="utf-8").stdout


def commits_per_seat():
    c = collections.Counter(l for l in git("log", "--format=%an").splitlines() if l)
    return dict(c.most_common())


def stage_lines_per_seat():
    out, author = collections.Counter(), None
    for line in git("log", "--format=@%an", "--numstat", "--", "stage-*").splitlines():
        if line.startswith("@"):
            author = line[1:]
        elif line.strip():
            parts = line.split("\t")
            if len(parts) == 3 and parts[0].isdigit():
                out[author] += int(parts[0])
    return dict(out)


def room():
    path = os.path.join(ROOT, "room.json")
    if not os.path.isfile(path):
        return None
    msgs = json.load(open(path, encoding="utf-8"))["messages"]
    text = [m for m in msgs if m.get("messageType") == "text"]
    human = [m for m in text if m.get("senderType") == "User"] or \
            [m for m in text if m.get("senderName") not in
             ("coordinator", "builder-a", "builder-b", "verifier", "investigator")]
    return {
        "events": len(msgs),
        "text_messages_by_sender": dict(collections.Counter(m["senderName"] for m in text).most_common()),
        "human_messages": [{"at": m["insertedAt"], "first_80_chars": (m.get("content") or "")[:80]}
                           for m in human],
        "first_event": msgs[0]["insertedAt"] if msgs else None,
        "last_event": msgs[-1]["insertedAt"] if msgs else None,
    }


def holdout():
    res = {}
    for f in sorted(glob.glob(os.path.join(ROOT, "evidence", "holdout", "stage-*", "holdout.json"))):
        stage = os.path.basename(os.path.dirname(f))
        d = json.load(open(f, encoding="utf-8"))
        cases = d.get("cases", d) if isinstance(d, dict) else d
        cases = [c for c in cases if isinstance(c, dict) and "result" in c]
        res[stage] = {"pass": sum(c["result"] == "pass" for c in cases), "total": len(cases),
                      "failing": [c["id"] for c in cases if c["result"] != "pass"]}
    return res


def official():
    res = {}
    for f in sorted(glob.glob(os.path.join(ROOT, "evidence", "stage-*", "official-*", "report.json"))):
        d = json.load(open(f, encoding="utf-8"))
        res[os.path.relpath(f, ROOT).replace("\\", "/")] = d.get("claimed_stage")
    return res


def blast_report():
    p = subprocess.run([sys.executable, "-m", "blast", "report", "--json"], cwd=os.path.join(ROOT, "tools"),
                       capture_output=True, text=True, encoding="utf-8")
    try:
        return json.loads(p.stdout)
    except ValueError:
        return {"error": p.stderr.strip()[:300]}


def main():
    m = {"commits_per_seat": commits_per_seat(), "stage_lines_added_per_seat": stage_lines_per_seat(),
         "room": room(), "holdout": holdout(), "official_claims": official(), "blast": blast_report()}
    out = os.path.join(ROOT, "evidence", "metrics.json")
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(m, fh, indent=2)
    print("wrote", os.path.relpath(out, ROOT))
    print("holdout:", {k: "%d/%d" % (v["pass"], v["total"]) for k, v in m["holdout"].items()})
    print("commits:", m["commits_per_seat"])
    print("human messages:", len(m["room"]["human_messages"]) if m["room"] else "-")


if __name__ == "__main__":
    main()
