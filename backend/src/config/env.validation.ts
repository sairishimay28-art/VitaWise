export function validateEnvironment(config: Record<string, any>) {
  const errors: string[] = [];

  const supabaseUrl = config.SUPABASE_URL || 'https://zvxqvelosmswdwntnpbe.supabase.co';
  if (!supabaseUrl.startsWith('https://')) {
    errors.push('SUPABASE_URL must be a valid HTTPS URL');
  }

  // We log diagnostic warnings if sensitive credentials are not yet injected into the environment
  if (!config.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(
      '⚠️ [VitaWise Config Warning] SUPABASE_SERVICE_ROLE_KEY is not set. Supabase admin features and RLS-bypassed table queries will be unavailable until supplied in .env or secrets.',
    );
  }

  if (!config.DATABASE_URL) {
    console.warn(
      '⚠️ [VitaWise Config Warning] DATABASE_URL is not set. Direct PostgreSQL connection pool will operate in unconfigured mode until supplied in .env or secrets.',
    );
  }

  // REDIS_URL is strictly optional in Phase 1
  const redisUrl = config.REDIS_URL?.trim();
  if (!redisUrl) {
    console.log(
      'ℹ️ [VitaWise Config Info] REDIS_URL is unconfigured. Operating in Phase 1 mode (in-memory execution; BullMQ & async workers dormant until Redis is configured).',
    );
  } else if (!redisUrl.startsWith('redis://') && !redisUrl.startsWith('rediss://')) {
    errors.push('When provided, REDIS_URL must be a valid redis:// or rediss:// connection URI');
  }

  if (errors.length > 0) {
    throw new Error(`Environment validation failed: ${errors.join(', ')}`);
  }

  return config;
}
