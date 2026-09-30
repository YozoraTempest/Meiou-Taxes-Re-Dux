#!/usr/bin/env sh
set -eu
directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$directory/VERIFY.mjs" "$@"
