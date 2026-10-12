// The local `erp` ESLint plugin (01-typescript-and-lint TS-12, TS-14, TS-16, TS-17; 04-shared-utilities
// UTIL-01). Consumers hold identical copies of configs/ (see configs/README.md).
// Each message ends with the rule id it enforces, so check:arch can assert a rule fired by its tag.

const LOOPS = new Set([
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
]);
const ITER = new Set([
  'forEach',
  'map',
  'filter',
  'reduce',
  'reduceRight',
  'some',
  'every',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flatMap',
]);
const isIterCallback = (fn) =>
  (fn.type === 'ArrowFunctionExpression' || fn.type === 'FunctionExpression') &&
  fn.parent?.type === 'CallExpression' &&
  fn.parent.arguments.includes(fn) &&
  fn.parent.callee.type === 'MemberExpression' &&
  !fn.parent.callee.computed &&
  ITER.has(fn.parent.callee.property.name);
/** In the BODY of a loop or iteration callback: `for (x of a.filter(f))` and `a.filter(f).map(g)` are NOT nested. */
export const insideAnotherLoop = (node) => {
  let child = node;
  for (let a = node.parent; a; child = a, a = a.parent) {
    if (LOOPS.has(a.type) && a.body === child) return true;
    if (isIterCallback(a) && a.body === child) return true;
  }
  return false;
};

const noNestedLoops = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      nested:
        'no nested loop: index one side into a Map or Set, or extract the inner loop into a named function (TS-12)',
    },
  },
  create(context) {
    const check = (node) => {
      if (insideAnotherLoop(node)) context.report({ node, messageId: 'nested' });
    };
    return {
      'ForStatement, ForInStatement, ForOfStatement, WhileStatement, DoWhileStatement': check,
      ':function': (fn) => {
        if (isIterCallback(fn)) check(fn);
      },
    };
  },
};

const QUERY_RECEIVER = /(repository|repo|prisma|facade)$/i;
/** Every identifier and non-computed property name along a callee's member chain. */
const chainNames = (node) => {
  const names = [];
  let n = node;
  while (n.type === 'MemberExpression') {
    if (!n.computed && n.property.type === 'Identifier') names.push(n.property.name);
    n = n.object;
  }
  if (n.type === 'Identifier') names.push(n.name);
  return names;
};

const noQueryInLoop = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      query:
        'no query inside a loop: load the set once (findMany with in, a facade batch method) and index it (TS-16)',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== 'MemberExpression') return;
        if (!chainNames(node.callee).some((name) => QUERY_RECEIVER.test(name))) return;
        if (insideAnotherLoop(node)) context.report({ node, messageId: 'query' });
      },
    };
  },
};

const FLAG = /^(ENABLE_|DISABLE_|FF_|FEATURE_FLAG_)|^SHOULD_(?!ENABLE_|DISABLE_)/;

const flagNaming = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: {
      flag: 'a feature flag is SHOULD_ENABLE_<NOUN> (default false) or SHOULD_DISABLE_<NOUN> (a kill switch) (TS-14)',
    },
  },
  create(context) {
    const check = (id) => {
      if (id?.type === 'Identifier' && FLAG.test(id.name)) {
        context.report({ node: id, messageId: 'flag' });
      }
    };
    return {
      VariableDeclarator: (node) => check(node.id),
      Property: (node) => {
        if (!node.computed) check(node.key);
      },
      TSPropertySignature: (node) => {
        if (!node.computed) check(node.key);
      },
      TSEnumMember: (node) => check(node.id),
    };
  },
};

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
/** The wrappers a JSDoc block sits above, e.g. the export and the const of an exported arrow. */
const DOC_HOLDERS = new Set([
  'VariableDeclarator',
  'VariableDeclaration',
  'MethodDefinition',
  'PropertyDefinition',
  'Property',
  'ExportNamedDeclaration',
  'ExportDefaultDeclaration',
]);

const requireComplexityNote = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: {
      note: 'a function with a loop here states its cost: add a JSDoc @complexity line, e.g. @complexity O(n) over the rows (TS-17)',
    },
  },
  create(context) {
    const seen = new Set();
    const hasNote = (fn) => {
      let holder = fn;
      while (holder.parent && DOC_HOLDERS.has(holder.parent.type)) holder = holder.parent;
      const doc = context.sourceCode
        .getCommentsBefore(holder)
        .filter((c) => c.type === 'Block' && c.value.startsWith('*'))
        .at(-1);
      return doc !== undefined && /@complexity\b/.test(doc.value);
    };
    const check = (loop) => {
      let fn = loop.parent;
      while (fn && !FUNCTIONS.has(fn.type)) fn = fn.parent;
      if (!fn || seen.has(fn)) return;
      seen.add(fn);
      if (!hasNote(fn)) context.report({ node: fn, messageId: 'note' });
    };
    return {
      'ForStatement, ForInStatement, ForOfStatement, WhileStatement, DoWhileStatement': check,
    };
  },
};

const GENERIC_FILE = /^(utils|helpers|common|misc)\.(ts|tsx|mts)$/;

const noGenericFilename = {
  meta: {
    type: 'suggestion',
    schema: [
      {
        type: 'object',
        properties: { allow: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      generic:
        'name the file after what it does; utils, helpers, common and misc are junk drawers (UTIL-01)',
    },
  },
  create(context) {
    const allow = context.options[0]?.allow ?? [];
    return {
      Program(node) {
        const file = context.filename.split('\\').join('/');
        if (!GENERIC_FILE.test(file.split('/').at(-1))) return;
        if (allow.some((suffix) => file.endsWith(suffix))) return;
        context.report({ node, messageId: 'generic' });
      },
    };
  },
};

export default {
  meta: { name: 'erp' },
  rules: {
    'no-nested-loops': noNestedLoops,
    'no-query-in-loop': noQueryInLoop,
    'flag-naming': flagNaming,
    'require-complexity-note': requireComplexityNote,
    'no-generic-filename': noGenericFilename,
  },
};
