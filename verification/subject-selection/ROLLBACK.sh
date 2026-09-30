#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo 'Usage: ROLLBACK.sh TARGET_ROOT BASELINE_ROOT' >&2
  exit 2
fi

to_unix_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$1"
  else
    printf '%s\n' "$1"
  fi
}

target="$(realpath "$(to_unix_path "$1")")"
baseline="$(realpath "$(to_unix_path "$2")")"
script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$target" == "$baseline" || "$target" == "$baseline/"* || "$baseline" == "$target/"* ||
      -e "$target/redux-tweak.modified-backup" || -e "$target/redux-tweak.mod.modified-backup" ]]; then
  echo 'Rollback roots overlap or backup already exists' >&2
  exit 1
fi

(cd -- "$target" && sha256sum -c "$script_directory/modified-hashes.sha256" >/dev/null)
(cd -- "$baseline" && sha256sum -c "$script_directory/baseline-hashes.sha256" >/dev/null)
mv -- "$target/redux-tweak" "$target/redux-tweak.modified-backup"
mv -- "$target/redux-tweak.mod" "$target/redux-tweak.mod.modified-backup"
cp -a -- "$baseline/redux-tweak" "$target/redux-tweak"
cp -- "$baseline/redux-tweak.mod" "$target/redux-tweak.mod"
(cd -- "$target" && sha256sum -c "$script_directory/baseline-hashes.sha256" >/dev/null)
echo 'ROLLBACK PASS: baseline 0.1.0 restored; modified copy retained; release installation untouched'
