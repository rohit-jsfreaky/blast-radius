# Stage 2 gate limitation record

Official isolated harness `official-s2-a` reports claimed stage 2; a separate Stage-1 run reports claimed stage 1. The Stage-2 run built the accepted Stage-1 source as its upgrade origin and passed its upgrade coverage.

Resource smoke against `stage-2` passed 100 availability reads in 462ms with RSS 50,044,928 bytes.

Local verifier coverage remains grouped and incomplete: the carried calibrated fixture sweep plus resource smoke cover core state integrity and availability. Browser/UI visual, DOM contract, out-of-order, uncertain-outcome and exhaustive combination probes are recorded limitations under L2.3-L2.15 and L2.18-L2.24; the official harness result is directional as stated by the harness.
