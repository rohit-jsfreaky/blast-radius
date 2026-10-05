# Checks

Probes written by @verifier (`checks/stage-N/`) and @investigator (`checks/sweep/INC-<n>/`), from the
requirements text only. Each probe prints a clear PASS/FAIL line with its ledger or incident id.
Next to each probe: `<probe>.calibration.json` — proof it FAILED on a known-bad version
(written by `blast calibrate`). A probe without a calibration does not count.
`checks/regression.txt` lists every calibrated probe re-run before each gate.
