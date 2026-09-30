#!/usr/bin/env sh
set -eu

if [ "$#" -ne 2 ]; then
    printf '%s\n' 'Usage: package.sh PLAN_JSON ARCHIVE_ZIP' >&2
    exit 2
fi

python - "$1" "$2" <<'PY'
import hashlib
import json
import os
import sys
import zipfile

with open(sys.argv[1], encoding="utf-8") as stream:
    plan = json.load(stream)
archive = os.path.abspath(sys.argv[2])
os.makedirs(os.path.dirname(archive), exist_ok=True)
with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
    for entry in plan["files"]:
        with open(os.path.join(plan["root"], entry["source"]), "rb") as source:
            content = source.read()
        if hashlib.sha256(content).hexdigest() != entry["sha256"]:
            raise ValueError("Source changed during build: " + entry["source"])
        info = zipfile.ZipInfo(entry["archive"], date_time=(2000, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        output.writestr(info, content, compresslevel=9)
with zipfile.ZipFile(archive) as output:
    entries = output.infolist()
    if [entry.filename for entry in entries] != [entry["archive"] for entry in plan["files"]]:
        raise ValueError("Archive allowlist differs")
    for entry, expected in zip(entries, plan["files"]):
        if hashlib.sha256(output.read(entry)).hexdigest() != expected["sha256"]:
            raise ValueError("Archive bytes differ: " + entry.filename)
print(f'PASS: PACKAGE {len(entries)} allowlisted entries; exact bytes verified; deterministic timestamps')
PY
