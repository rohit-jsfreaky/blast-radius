"""Command line: python -m blast [--repo PATH] <graph|origin|family|card check|calibrate|report> ..."""
import argparse
import sys

from . import __version__, commands, util
from .graph import Graph

HELP = """blast: trace a defect to where it was born, then list everything else born there.

commands:
  graph [--json] [--strict]            counts per node kind + orphans (untraceable work)
  origin <path>:<line> | --commit SHA  walk back: blame -> commit trailers -> work item -> handoff -> origin ids
  family <ID>                          everything born from L.. F.. H.. D.. S.. or WI.. (the sweep's sibling list)
  card check <INC-n.md>... [--room room.json] [--spec FILE]
                                       validate incident cards mechanically ("card ok" or one line per failure)
  calibrate <probe> --bad <rev|folder|url> [--good <rev|folder|url>] [--start "<cmd>"]
                                       prove a probe FAILS on a known-bad; writes <probe>.calibration.json
  report [--json]                      the run's numbers (incidents, origins, sweep, recurrence, probes)

--repo PATH works before or after the command; default = the git repository around the current folder.
"""


def _pull_repo(argv):
    repo, rest, i = None, [], 0
    while i < len(argv):
        a = argv[i]
        if a == "--repo" and i + 1 < len(argv):
            repo = argv[i + 1]
            i += 2
            continue
        if a.startswith("--repo="):
            repo = a.split("=", 1)[1]
            i += 1
            continue
        rest.append(a)
        i += 1
    return repo, rest


def build_parser():
    p = argparse.ArgumentParser(prog="blast", description=HELP, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--version", action="version", version="blast " + __version__)
    sub = p.add_subparsers(dest="cmd")
    g = sub.add_parser("graph", help="counts + orphans")
    g.add_argument("--json", action="store_true")
    g.add_argument("--strict", action="store_true", help="exit 1 when there are orphans (gate lint)")
    o = sub.add_parser("origin", help="walk a line or commit back to its origin ids")
    o.add_argument("location", nargs="?", help="<path>:<line>")
    o.add_argument("--commit")
    o.add_argument("--json", action="store_true")
    f = sub.add_parser("family", help="everything born from one origin id")
    f.add_argument("id")
    f.add_argument("--json", action="store_true")
    c = sub.add_parser("card", help="incident card tools")
    csub = c.add_subparsers(dest="cardcmd")
    cc = csub.add_parser("check", help="validate incident cards")
    cc.add_argument("cards", nargs="+")
    cc.add_argument("--room")
    cc.add_argument("--spec", action="append", default=[], help="extra file(s) where an origin quote may appear")
    k = sub.add_parser("calibrate", help="run a probe on the known-bad and the current target")
    k.add_argument("probe")
    k.add_argument("--bad", required=True)
    k.add_argument("--good")
    k.add_argument("--start", help='command that starts the service; {dir} and {url} are filled in')
    k.add_argument("--wait", type=float, default=3.0, help="seconds to wait after --start (default 3)")
    k.add_argument("--timeout", type=float, default=300.0)
    k.add_argument("--bad-url")
    k.add_argument("--good-url")
    r = sub.add_parser("report", help="the run's numbers")
    r.add_argument("--json", action="store_true")
    return p


def main(argv=None):
    util.setup_stdout()
    argv = list(sys.argv[1:] if argv is None else argv)
    repo_arg, argv = _pull_repo(argv)
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.cmd:
        parser.print_help()
        return 0
    repo = util.find_repo(repo_arg)
    if not repo:
        print("blast: not inside a git repository; pass --repo <path>", file=sys.stderr)
        return 2
    try:
        g = Graph(repo).load()
    except util.GitError as e:
        print("blast: %s" % e, file=sys.stderr)
        return 2
    rc = 0
    if args.cmd == "graph":
        rc = commands.cmd_graph(g, args.json, args.strict)
    elif args.cmd == "origin":
        if not args.location and not args.commit:
            print("blast origin: give <path>:<line> or --commit <sha>", file=sys.stderr)
            return 2
        rc = commands.cmd_origin(g, args.location, args.commit, args.json)
    elif args.cmd == "family":
        rc = commands.cmd_family(g, args.id.strip(), args.json)
    elif args.cmd == "card":
        if args.cardcmd != "check":
            print("blast card: only 'card check <INC-n.md>' exists", file=sys.stderr)
            return 2
        rc = commands.cmd_card_check(g, args.cards, args.room, args.spec)
    elif args.cmd == "calibrate":
        rc = commands.cmd_calibrate(g, args.probe, args.bad, args.good, args.start, args.wait, args.timeout,
                                    args.bad_url, args.good_url)
    elif args.cmd == "report":
        rc = commands.cmd_report(g, args.json)
    for w in g.warnings:
        print("warning: " + w, file=sys.stderr)
    return rc
