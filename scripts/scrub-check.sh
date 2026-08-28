#!/usr/bin/env bash
#
# Publish gate.
#
# n8n-lint is cut from a private business vault into a public, MIT-licensed
# repo. Nothing that identifies that vault, the business it belongs to, or a
# real credential may enter the tracked tree. This script runs `git grep`
# over the tracked tree for patterns that must never appear and fails the
# build if it finds one.
#
# Run it before every commit: npm run scrub

set -euo pipefail

fail=0

# This script necessarily names the very patterns it forbids (see the list
# below), so it must be excluded from its own scan - otherwise it fails the
# moment it is committed.
SELF='scripts/scrub-check.sh'

report() {
  fail=1
  echo "scrub-check: FAIL - $1"
}

# ---------------------------------------------------------------------------
# 1. Patterns that must never appear anywhere in the tracked tree.
# ---------------------------------------------------------------------------
FORBIDDEN_PATTERNS=(
  'sk-ant-[A-Za-z0-9_-]+'    # an Anthropic API key
  'BEGIN [A-Z ]*PRIVATE KEY' # any PEM private-key header
  'AI OS_second brain'       # the private vault this repo was cut from
  'bolteniq'                 # the business this repo was cut from
)

for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  hits=$(git grep -n -I -E -i -e "$pattern" -- . ":!$SELF" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    report "forbidden pattern '$pattern' found:"
    echo "$hits" | sed 's/^/    /'
  fi
done

# ---------------------------------------------------------------------------
# 2. corpus/ is 479 real production workflows - client work, gitignored, and
# must never be committed or referenced by path. A bare mention of the
# directory name (as in .gitignore, or in prose describing the rule) is fine;
# an actual path INTO it - e.g. a real filename pasted into a doc or log - is
# not. scripts/pull-corpus.mjs is the one script whose job is writing into
# ./corpus and is allowed to name it.
# ---------------------------------------------------------------------------
CORPUS_PULL='scripts/pull-corpus.mjs'

corpus_hits=$(git grep -n -E -e 'corpus/[A-Za-z0-9._-]' -- . ":!$SELF" ':!.gitignore' ":!$CORPUS_PULL" 2>/dev/null || true)
if [ -n "$corpus_hits" ]; then
  report "a path into corpus/ (client work) was found:"
  echo "$corpus_hits" | sed 's/^/    /'
fi

# Belt and braces on the hard constraint itself: no file living under corpus/
# may ever be tracked by git, regardless of .gitignore.
tracked_corpus_files=$(git ls-files -- 'corpus/*' 2>/dev/null || true)
if [ -n "$tracked_corpus_files" ]; then
  report "files under corpus/ are tracked by git and must never be committed:"
  echo "$tracked_corpus_files" | sed 's/^/    /'
fi

# ---------------------------------------------------------------------------
# 3. Private, client-specific patterns that don't belong in a public repo.
# Kept out of this file on purpose: scripts/scrub-patterns.local is
# gitignored and never published. One extended-regex fragment per line;
# blank lines and #-comments are ignored.
# ---------------------------------------------------------------------------
LOCAL="$(dirname "$0")/scrub-patterns.local"
if [ -f "$LOCAL" ]; then
  while IFS= read -r pattern; do
    case "$pattern" in
      ''|'#'*) continue ;;
    esac
    hits=$(git grep -n -I -E -i -e "$pattern" -- . ":!$SELF" ":!$LOCAL" 2>/dev/null || true)
    if [ -n "$hits" ]; then
      report "local forbidden pattern '$pattern' found:"
      echo "$hits" | sed 's/^/    /'
    fi
  done < "$LOCAL"
fi

if [ "$fail" -eq 0 ]; then
  echo "scrub-check: clean"
  exit 0
fi

echo "scrub-check: refusing to publish"
exit 1
