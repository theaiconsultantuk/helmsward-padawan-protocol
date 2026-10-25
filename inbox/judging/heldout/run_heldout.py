#!/usr/bin/env python3
"""Run heldout-inputs.json against a LOCAL inbox server in sample mode, compare with heldout-labels.json.
Usage: python3 run_heldout.py http://127.0.0.1:8899 [run-id-prefix]   (labels stay in a separate file, thresholds must not be tuned on this set)"""
import json, sys, urllib.request, urllib.error, os
base = sys.argv[1].rstrip("/")
prefix = sys.argv[2] if len(sys.argv) > 2 else "heldout"  # run ids must be new on each run
here = os.path.dirname(os.path.abspath(__file__))
inputs = json.load(open(os.path.join(here, "heldout-inputs.json")))
labels = {l["id"]: l for l in json.load(open(os.path.join(here, "heldout-labels.json")))}
rows = []
for c in inputs:
    body = {"run_id": prefix + "-" + c["id"].lower(), "input": c["input"], "options": {"sample_mode": True}}
    req = urllib.request.Request(base + "/run", json.dumps(body).encode(), {"Content-Type": "application/json"})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=60)); code = 200
    except urllib.error.HTTPError as e:
        code = e.code
        try: r = json.load(e)
        except Exception: r = {}
    out = r.get("output") or {}
    got = out.get("decision") or ("error" if r.get("status") == "error" else "none")
    d = out.get("draft") or {}
    why = ((out.get("reasons") or [""])[0])[:110]
    ok = got in labels[c["id"]]["expected_any_of"]
    promise = (d.get("promises") or {}).get("refund_amount")
    rows.append((c["id"], labels[c["id"]]["tag"], got, "/".join(labels[c["id"]]["expected_any_of"]), ok, code, promise, r.get("branch_id"), why))
for x in rows:
    print("%s %-24s got=%-9s want=%-15s %s http=%s promise=%s branch=%s | %s" % (x[0], x[1], x[2], x[3], "PASS" if x[4] else "FAIL", x[5], x[6], x[7], x[8]))
print("pass %d / %d" % (sum(1 for x in rows if x[4]), len(rows)))
