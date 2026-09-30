#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo 'Usage: ROLLBACK.sh MOD_DIRECTORY BACKUP_DIRECTORY' >&2
  exit 2
fi

to_unix_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$1"
  else
    printf '%s\n' "$1"
  fi
}

mod_directory="$(to_unix_path "$1")"
backup_directory="$(to_unix_path "$2")"
target="$mod_directory/redux-tweak"
launcher="$mod_directory/redux-tweak.mod"

check_hash() {
  local actual
  actual="$(sha256sum "$1" | cut -d ' ' -f 1)"
  if [[ "$actual" != "$2" ]]; then
    echo "Unexpected content: $1" >&2
    exit 1
  fi
}

check_hash "$mod_directory/MEIOUandTaxes1/interface/provinceview.gui" 2cfcc89956b89ba4948f902a6152ba232241119b654fdb1cd74afbfcccdb1214
check_hash "$mod_directory/Pop Display/interface/provinceview.gui" 4eea36e04375d2cac1f7cb44e9e7367f99b1d439117098cc5661320258634788
check_hash "$target/descriptor.mod" c7af00b74b1a724a3486954c73ef81ca83431e49494f17e6500fb1905ec3611f
check_hash "$target/interface/provinceview.gui" 697df7dfd78b3b2266060730dcd0d3ddccc17fcf22f45b89482e6ccdf81d2058
check_hash "$target/common/scripted_effects/SYS-Construct.txt" f179ed5e26fb1469d5d57ac173313261295f35a9a94f772f21c13a597f002ca3
check_hash "$target/common/custom_gui/ReduxSubjectSelection.txt" 18598e2ef0c351d4c8a0a720b4a7263f7e24e901dff3946dec2f1451d3361b00
check_hash "$target/localisation/redux-tweak_l_english.yml" ea500c241e9fea083151fa7fa15f2ff217e6bb137c5816e5b2f3d57048e9f17f

if [[ "$(find "$target" -type f | wc -l | tr -d ' ')" != 5 || -e "$backup_directory" ]]; then
  echo 'Unexpected installed files or backup destination already exists' >&2
  exit 1
fi
grep -Fxq 'name="Redux Tweak"' "$launcher"
grep -Fxq '    "MEIOU and Taxes v3.0"' "$launcher" || grep -Fxq $'\t"MEIOU and Taxes v3.0"' "$launcher"
grep -Fxq '    "Pop Display"' "$launcher" || grep -Fxq $'\t"Pop Display"' "$launcher"
grep -Eq '^path="[^\"]+/redux-tweak"$' "$launcher"

mkdir -p -- "$backup_directory"
mv -- "$target" "$backup_directory/redux-tweak"
mv -- "$launcher" "$backup_directory/redux-tweak.mod"
echo 'ROLLBACK PASS: Redux Tweak moved to backup; Pop Display and MEIOU unchanged'
