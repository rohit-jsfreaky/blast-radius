# INC-<n> — <one-line symptom>

status: open | closed
stage: <N>
found-by: <verifier REJECT R… | official check <suite/test name> | builder self-report | sweep of INC-…>
symptom: <one line>
evidence: <path to the failing output>
defect-commit: <full hash — the commit that introduced it (git blame)>
fix-commit: <full hash>

## Origin
kind: <L | F | H | D | S | local>
id: <L3.14 | F2 | H2.1 | D7 | S3>
quote: "<exact text of the requirement / handoff / decision this was born from>"
traced: <the hops — faulty lines → blame commit → Work-Item → handoff → origin id>
why this origin: <the earliest point where the defect became inevitable, in one or two sentences>
family rule: <the one rule every sibling shares, in plain words>

## Family and sweep
| sibling | kind | owner | probe | calibrated on (known-bad) | result on rev | action |
|---|---|---|---|---|---|---|
| <WI / file:function / L id> | <same rule, other place> | <seat> | <checks/... path> | <rev or scratch copy> → FAIL | PASS / FAIL | CLEARED / REJECT INC<n>.<m> → FIXED <hash> |

## Close
siblings checked: <k> · failing found: <f> · fixed: <f> · cleared: <k−f>
regression set: <probe paths added>
forward risk: <the words to watch for in later stages' requirements>
closed: <shell-clock time> on rev <hash>
