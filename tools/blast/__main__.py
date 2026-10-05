"""Entry point: `python -m blast <command>` or `python tools/blast/__main__.py <command>`."""
import os
import sys

if __package__ in (None, ""):
    # Run as a plain script: make the folder that holds the package importable.
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from blast.cli import main
else:
    from .cli import main

if __name__ == "__main__":
    sys.exit(main())
