// commit-msg: conventional commits with a scope; no em dash in the header; no attribution
// trailer; no length limit (D-21: most existing subjects exceed 100 characters).
const EM_DASH = '\u2014';
export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-em-dash': ({ header }) => [
          !(header ?? '').includes(EM_DASH),
          'no em dash (U+2014) in the header; use a colon or a hyphen',
        ],
        'no-attribution-trailer': ({ raw }) => [
          !/^(co-authored-by:|\W*generated with \[)/im.test(raw ?? ''),
          'no attribution trailer (Co-Authored-By, Generated with): plain conventional commits only',
        ],
      },
    },
  ],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'build',
        'chore',
        'ci',
        'docs',
        'feat',
        'fix',
        'perf',
        'plan',
        'refactor',
        'revert',
        'style',
        'test',
      ],
    ],
    'scope-empty': [2, 'never'],
    'header-max-length': [0],
    'subject-case': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    'no-em-dash': [2, 'always'],
    'no-attribution-trailer': [2, 'always'],
  },
};
