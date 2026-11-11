import path from 'path';

/**
 * Known production Postgres host prefixes/patterns and live local SQLite paths
 * that must NEVER receive synthetic test fixtures or automated test cleanup.
 */
const BLOCKED_PRODUCTION_HOST_PATTERNS = [
  /ep-flat-union-b58rn3f5/i,
];

function stripQuotes(val) {
  return String(val || '').replace(/^['"]|['"]$/g, '').trim();
}

export function resolveSqliteDatabasePath() {
  const override = stripQuotes(process.env.SQLITE_DB_PATH);
  if (override) {
    return path.resolve(override);
  }
  return path.resolve(path.join(process.cwd(), 'data', 'app.db'));
}

export function getActiveDialect() {
  const forced = stripQuotes(process.env.DB_DRIVER).toLowerCase();
  if (forced === 'sqlite') return 'sqlite';
  if (forced === 'postgres' || forced === 'postgresql') return 'postgres';
  return process.env.DATABASE_URL ? 'postgres' : 'sqlite';
}

/**
 * Inspects active connection settings and classifies environment safety.
 * Never connects or mutates data on its own.
 */
export function getDatabaseEnvironment() {
  const dialect = getActiveDialect();
  const nodeEnv = String(process.env.NODE_ENV || '');

  if (dialect === 'sqlite') {
    const resolvedPath = resolveSqliteDatabasePath();
    const liveAppDbPath = path.resolve(path.join(process.cwd(), 'data', 'app.db'));
    const parentAppDbPath = path.resolve(path.join(process.cwd(), '..', 'data', 'app.db'));
    const fileName = path.basename(resolvedPath).toLowerCase();
    const isLiveAppDb = resolvedPath === liveAppDbPath || resolvedPath === parentAppDbPath;
    const isExplicitTestFile =
      Boolean(stripQuotes(process.env.SQLITE_DB_PATH)) &&
      !isLiveAppDb &&
      (fileName.includes('test') || resolvedPath.toLowerCase().includes(`${path.sep}tmp${path.sep}`) || resolvedPath.toLowerCase().includes('scratch'));

    return {
      dialect: 'sqlite',
      nodeEnv,
      target: resolvedPath,
      isProduction: isLiveAppDb,
      isIsolatedTestDb: isExplicitTestFile,
      reason: isLiveAppDb
        ? `Resolved SQLite path targets live database (${resolvedPath}).`
        : isExplicitTestFile
          ? `Isolated SQLite test database (${resolvedPath}).`
          : `Unrecognized SQLite path (${resolvedPath}); set SQLITE_DB_PATH to a dedicated test_* path.`,
    };
  }

  const rawUrl = stripQuotes(process.env.DATABASE_URL);
  if (!rawUrl) {
    return {
      dialect: 'postgres',
      nodeEnv,
      target: '',
      isProduction: true,
      isIsolatedTestDb: false,
      reason: 'DATABASE_URL is empty while DB_DRIVER=postgres.',
    };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      dialect: 'postgres',
      nodeEnv,
      target: '(unparseable DATABASE_URL)',
      isProduction: true,
      isIsolatedTestDb: false,
      reason: 'DATABASE_URL could not be parsed safely.',
    };
  }

  const host = parsed.hostname || '';
  const dbName = (parsed.pathname || '').replace(/^\//, '');
  const matchesBlockedProd = BLOCKED_PRODUCTION_HOST_PATTERNS.some((rx) => rx.test(host));
  const allowedTestHost = stripQuotes(process.env.SERPHAWK_ALLOWED_TEST_PG_HOST);
  const allowedTestDb = stripQuotes(process.env.SERPHAWK_ALLOWED_TEST_PG_DB);

  const isExplicitTestBranch =
    !matchesBlockedProd &&
    Boolean(allowedTestHost) &&
    host.toLowerCase() === allowedTestHost.toLowerCase() &&
    (!allowedTestDb || dbName.toLowerCase() === allowedTestDb.toLowerCase());

  return {
    dialect: 'postgres',
    nodeEnv,
    target: `${host}/${dbName}`,
    host,
    dbName,
    matchesBlockedProd,
    isProduction: matchesBlockedProd || !isExplicitTestBranch,
    isIsolatedTestDb: isExplicitTestBranch,
    reason: matchesBlockedProd
      ? `Postgres endpoint "${host}" matches blocked production Neon instance.`
      : isExplicitTestBranch
        ? `Verified isolated Postgres test branch "${host}/${dbName}".`
        : `Postgres endpoint "${host}/${dbName}" is not explicitly whitelisted via SERPHAWK_ALLOWED_TEST_PG_HOST.`,
  };
}

/**
 * Hard gate for ANY test runner, synthetic fixture tracker, or cleanup script.
 * Unconditionally blocks production Neon Postgres and live app.db regardless of NODE_ENV.
 */
export function assertIsolatedTestDatabase(operationName = 'test operation') {
  const env = getDatabaseEnvironment();
  if (env.isProduction || !env.isIsolatedTestDb) {
    throw new Error(
      `[DB SAFETY ABORT] "${operationName}" refused on non-isolated database (${env.dialect}: ${env.target}). ` +
        `${env.reason} Production DBs and live app.db are strictly blocked from synthetic data writes and cleanup.`
    );
  }
  return env;
}

/**
 * Runtime connection identity check for Postgres migrations to verify active database name & host.
 * Does NOT authorize testing or cleanup.
 */
export async function verifyPostgresConnectionIdentity(poolOrClient) {
  const result = await poolOrClient.query(
    'SELECT current_database() AS db_name, current_user AS db_user, version() AS pg_version'
  );
  return result.rows[0] || null;
}

/**
 * Explicit separation guard for production/staging schema migrations & non-destructive backfills.
 * Rejects execution if test harness flags or cleanup modes are present in argv/env.
 */
export function assertMigrationContextOnly(scriptName = 'migration') {
  const argv = process.argv.slice(2).join(' ');
  if (/--run-id|--confirm-clean|--seed-test/i.test(argv) || process.env.SERPHAWK_TEST_RUN_ID) {
    throw new Error(
      `[AUTHORIZATION SEPARATION ERROR] "${scriptName}" cannot run with test/cleanup arguments or SERPHAWK_TEST_RUN_ID.`
    );
  }
  return getDatabaseEnvironment();
}
