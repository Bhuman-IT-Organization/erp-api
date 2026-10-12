// ADR-0031 §4 enforcement: the rendered DATABASE_URL must carry an explicit pool budget
// (`connection_limit`). The timeouts (`pool_timeout`, `connect_timeout`, `socket_timeout`) are
// code — TIMINGS.db — and PrismaService appends them when absent, so they are not required here.
// Runs from `check:db` under dotenv with ../erp-infra/env/local/api.host.env. Never prints the
// URL (it holds the password); only the parameter values that matter.
const url = process.env.DATABASE_URL;
if (url === undefined || url === '') {
  console.error('database url: DATABASE_URL is not set (render ../erp-infra/env/local first)');
  process.exit(1);
}

const params = new URL(url).searchParams;
const connectionLimit = params.get('connection_limit');
if (connectionLimit === null || !/^[1-9]\d*$/.test(connectionLimit)) {
  console.error(
    'database url: connection_limit= is missing or not a positive integer — erp-infra renders the pool budget (ADR-0031 §4, "Pool budget" in its README)',
  );
  process.exit(1);
}
console.log(
  `database url: connection_limit=${connectionLimit} pool_timeout=${params.get('pool_timeout') ?? '(TIMINGS.db)'}`,
);
