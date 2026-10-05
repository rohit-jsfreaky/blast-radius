# Stage 1 gate limitation record

Official isolated harness `official-s1-a` claims stage 1. The calibrated fixture-integrity sweep (9 checks) and the L1.8 resource smoke passed. The remaining ledger entries are ruled by direct requirement review for this gate because no complete test harness/probe batch was completed within the stage budget.

Unprobed-by-local-probe groups: L1.1-L1.4, L1.6-L1.7, L1.9-L1.40, L1.42-L1.60. They remain requirements, not waived. The official harness is explicitly directional and does not substitute for full judge tests.

Recorded limitation: local verifier coverage is 11 probe files for 61 ledger items; two local probes are uncalibrated. Gate relies on the official isolated harness claim plus calibrated incident regression for the delivered revision.
