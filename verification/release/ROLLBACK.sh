#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo 'Usage: ROLLBACK.sh ARCHIVE_PATH BACKUP_PATH' >&2
  exit 2
fi

to_unix_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$1"
  else
    printf '%s\n' "$1"
  fi
}

archive="$(to_unix_path "$1")"
backup="$(to_unix_path "$2")"
expected=01c33c573292f777bc423bf6a3cfe9c302cc90983a812946e52e2fbcb1694321
actual="$(sha256sum "$archive" | cut -d ' ' -f 1)"
if [[ "$actual" != "$expected" || -e "$backup" ]]; then
  echo 'Archive content differs or backup already exists' >&2
  exit 1
fi

mv -- "$archive" "$backup"
echo 'ROLLBACK PASS: test release archive moved to backup; source files unchanged'
