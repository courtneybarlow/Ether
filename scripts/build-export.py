#!/usr/bin/env python3
"""Pack an ArtifactData export folder (collection/doc_id.json files) into one ether-export.json for the in-app importer."""
import json, os, sys, datetime
root, out = sys.argv[1], sys.argv[2]
docs = []
for d, _, files in os.walk(root):
    for f in files:
        if not f.endswith('.json'): continue
        rel = os.path.relpath(os.path.join(d, f), root)[:-5].replace(os.sep, '/')
        docs.append({'path': rel, 'data': json.load(open(os.path.join(d, f)))})
docs.sort(key=lambda x: x['path'])
json.dump({'exportedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'from': 'Ether (Claude version)', 'docs': docs}, open(out, 'w'), indent=1)
print(len(docs), 'records ->', out)
