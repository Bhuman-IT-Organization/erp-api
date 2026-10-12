// pre-commit: staged files only. configs/ and the generated ratchet files
// are prettier-ignored in every consumer; ESLint ignores configs/**.
export default {
  // --no-warn-ignored: a staged file under an ESLint ignore (src/components/ui, configs) is skipped, not a warning that
  // --max-warnings 0 would turn into a refused commit.
  '*.{ts,tsx,mts}': ['eslint --fix --max-warnings 0 --no-warn-ignored', 'prettier --write'],
  '*.{js,mjs,cjs,json,md,css,yml,yaml}': ['prettier --write --ignore-unknown'],
};
