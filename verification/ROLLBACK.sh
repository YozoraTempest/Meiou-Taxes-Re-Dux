#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "${1:-.}" && pwd -P)"
expected_head="15a1f3dde9aea4de6121aa30a86270a79c583924"
expected_readme="9d6d89bac43ce239cecf700a91ce74204b4ab5d478561c7d693dc491764a33cb"
expected_mod="dd6868b34ec58d0fa316fedb067acced762dfc43e862ec5e77fbc06ee430fc25"
expected_descriptor="319e7ffd8ea39d9ef5cbecfd07471edea8a9087c10b706d5bcaac2bc83994bc2"

if [[ "$(git -C "$root" rev-parse HEAD)" != "$expected_head" ]]; then
  echo "Unexpected base commit; rollback aborted" >&2
  exit 1
fi

for entry in \
  "$root/README.md:$expected_readme" \
  "$root/redux-tweak.mod:$expected_mod" \
  "$root/redux-tweak/descriptor.mod:$expected_descriptor"; do
  file="${entry%%:*}"
  expected="${entry##*:}"
  if [[ ! -f "$file" || "$(sha256sum "$file" | cut -d ' ' -f 1)" != "$expected" ]]; then
    echo "Modified or missing file: $file; rollback aborted" >&2
    exit 1
  fi
done

git -C "$root" show HEAD:README.md > "$root/README.md"
rm -- "$root/redux-tweak.mod" "$root/redux-tweak/descriptor.mod"
rmdir -- "$root/redux-tweak"
echo "ROLLBACK PASS: README restored; redux-tweak removed"
