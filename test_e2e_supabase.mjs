/**
 * VitaWise End-to-End Supabase Integration Verification Test
 * 
 * Verifies:
 * 1. Backend starts & responds to /api/v1/health
 * 2. Supabase connection succeeds (https://zvxqvelosmswdwntnpbe.supabase.co)
 * 3. PostgreSQL query succeeds via DATABASE_URL & pgvector is active
 * 4. Authentication works: Signup, Login, JWT session acquisition
 * 5. Test user profile & preferences seeded into Supabase PostgreSQL
 * 6. Protected API validates Bearer token (/api/v1/auth/me)
 * 7. Real record written: nutrition_logs & symptom_logs
 * 8. Real record read back and validated
 * 9. Unauthorized request without token is rejected (401)
 * 10. Realtime publication verified
 * 11. Storage buckets verified & signed upload URL generated
 * 12. No secrets or connection strings exposed
 */

const BASE_URL = 'http://127.0.0.1:3001';

async function runTests() {
  console.log('====================================================');
  console.log('  VITAWISE — END-TO-END SUPABASE INTEGRATION TEST   ');
  console.log('  Target: https://zvxqvelosmswdwntnpbe.supabase.co   ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failed++;
    }
  }

  // TEST 1: Health Endpoint
  console.log('[TEST 1] Backend Health & Connectivity Probe');
  const healthRes = await fetch(`${BASE_URL}/api/v1/health`);
  const health = await healthRes.json();
  assert(healthRes.status === 200, 'Health endpoint returns HTTP 200');
  assert(health.connectivity.supabase.status === 'online', 'Supabase status is ONLINE');
  assert(health.connectivity.supabase.url === 'https://zvxqvelosmswdwntnpbe.supabase.co', 'Project URL verified');
  assert(health.connectivity.database.status === 'online', 'PostgreSQL database status is ONLINE');
  assert(health.connectivity.database.pgvectorInstalled === true, 'pgvector extension is INSTALLED and ACTIVE');
  assert(health.connectivity.queue.enabled === false, 'Redis queue dormant in Phase 1 as designed (no crash)');

  // TEST 2: Database Schema Health & Inspection
  console.log('\n[TEST 2] PostgreSQL Safe Query & Table Introspection');
  const dbRes = await fetch(`${BASE_URL}/api/v1/health/database`);
  const dbHealth = await dbRes.json();
  assert(dbRes.status === 200, 'Database health returns HTTP 200');
  assert(dbHealth.postgres.connected === true, 'Postgres connection active');
  assert(dbHealth.schema.tablesCount >= 25, `Schema has ${dbHealth.schema.tablesCount} tables (>= 25)`);
  assert(dbHealth.postgres.latencyMs !== null && dbHealth.postgres.latencyMs < 2000, `Postgres query latency: ${dbHealth.postgres.latencyMs}ms`);

  // TEST 3: Authentication - Signup
  console.log('\n[TEST 3] Supabase Auth Signup Flow');
  const testEmail = `vitawise.test.${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';
  const signupRes = await fetch(`${BASE_URL}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail,
      password: testPassword,
      fullName: 'Clinical Test User',
      phone: '+919876543210',
      role: 'patient',
      languagePreference: 'te',
    }),
  });
  const signupData = await signupRes.json();
  assert(signupRes.status === 201, `Signup succeeds with HTTP 201 (Status: ${signupRes.status})`);
  assert(signupData.user && signupData.user.id, `User registered in Supabase Auth: ${signupData.user?.id}`);
  assert(signupData.session && signupData.session.accessToken, 'Access Token issued by Supabase Auth');

  const token = signupData.session?.accessToken;
  const userId = signupData.user?.id;

  // TEST 4: Authentication - Login
  console.log('\n[TEST 4] Supabase Auth Login Flow');
  const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail,
      password: testPassword,
    }),
  });
  const loginData = await loginRes.json();
  assert(loginRes.status === 200, 'Login succeeds with HTTP 200');
  assert(loginData.session && loginData.session.accessToken, 'Valid JWT session returned');

  // TEST 5: Protected Profile Endpoint
  console.log('\n[TEST 5] Protected Profile Endpoint (Bearer Token Verification)');
  const meRes = await fetch(`${BASE_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meData = await meRes.json();
  assert(meRes.status === 200, 'Authenticated /me returns HTTP 200');
  assert(meData.user.email === testEmail, `User email matches: ${meData.user.email}`);
  assert(meData.user.full_name === 'Clinical Test User', 'Profile read from Supabase PostgreSQL public.users');

  // TEST 6: Unauthorized Access Protection
  console.log('\n[TEST 6] Authorization Enforcement (Reject Unauthenticated Request)');
  const unauthRes = await fetch(`${BASE_URL}/api/v1/auth/me`);
  assert(unauthRes.status === 401, 'Request without Bearer token rejected with HTTP 401');

  // TEST 7: Write & Read Nutrition Log (PostgreSQL Persistence)
  console.log('\n[TEST 7] Clinical Data Persistence: Nutrition Log');
  const mealRes = await fetch(`${BASE_URL}/api/v1/health/nutrition-logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      mealType: 'breakfast',
      foodName: 'Ragi Idli with Sambar and Mint Chutney',
      portionDescription: '2 idlis (150g)',
      estimatedCalories: 280,
      proteinG: 9.5,
      carbsG: 42,
      fatG: 4,
      fiberG: 7.2,
      glycemicIndexLevel: 'low',
    }),
  });
  const mealData = await mealRes.json();
  assert(mealRes.status === 201, 'Nutrition log created with HTTP 201');
  assert(mealData.data && mealData.data.id, `Saved in public.nutrition_logs with UUID: ${mealData.data?.id}`);

  // Read back
  const getMealsRes = await fetch(`${BASE_URL}/api/v1/health/nutrition-logs`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const getMealsData = await getMealsRes.json();
  assert(getMealsRes.status === 200, 'Get nutrition logs returns HTTP 200');
  assert(getMealsData.count >= 1, `Read back ${getMealsData.count} log(s) from Supabase PostgreSQL`);
  assert(getMealsData.logs[0].food_name.includes('Ragi Idli'), 'Stored record integrity verified');

  // TEST 8: Write & Read Symptom Log
  console.log('\n[TEST 8] Clinical Data Persistence: Symptom Log');
  const symptomRes = await fetch(`${BASE_URL}/api/v1/health/symptom-logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      symptomCategory: 'pcos',
      symptomName: 'Fatigue and carbohydrate craving',
      severity: 3,
      notes: 'Occurred 2 hours after lunch',
    }),
  });
  const symptomData = await symptomRes.json();
  assert(symptomRes.status === 201, 'Symptom log created with HTTP 201');
  assert(symptomData.data && symptomData.data.severity === 3, 'Symptom log severity stored in database');

  // TEST 9: Multi-Device Sync (Android <-> Web)
  console.log('\n[TEST 9] Multi-Device Synchronization (Android <-> Web)');
  const syncRes = await fetch(`${BASE_URL}/api/v1/health/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      deviceId: 'android-pixel-test-device-01',
      clientPlatform: 'android',
      syncType: 'full',
    }),
  });
  const syncData = await syncRes.json();
  assert(syncRes.status === 201, 'Sync operation logged with HTTP 201');
  assert(syncData.sourceOfTruth.includes('Supabase PostgreSQL'), 'Single source of truth confirmed');
  assert(syncData.payload.nutritionLogs.length >= 1, 'Sync payload delivers nutrition logs across devices');
  assert(syncData.payload.symptomLogs.length >= 1, 'Sync payload delivers symptom logs across devices');

  // TEST 10: Server-Side AI Assessment + Supabase Persistence
  console.log('\n[TEST 10] Server-Side AI Assessment & Supabase Persistence');
  const aiRes = await fetch(`${BASE_URL}/api/v1/ai/assess`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      cycleIrregularity: true,
      hirsutismOrAcne: true,
      dietaryContext: 'South Indian Vegetarian diet with polished white rice',
      query: 'Experiencing irregular 45-day cycles and lethargy',
      language: 'en',
    }),
  });
  const aiData = await aiRes.json();
  assert(aiRes.status === 201, 'AI assessment executed with HTTP 201');
  assert(aiData.persistedInSupabase === true, `AI assessment persisted in public.ai_assessments: ${aiData.assessmentId}`);
  assert(aiData.recommendations.length > 0, `Generated ${aiData.recommendations.length} clinical recommendations`);
  assert(aiData.riskLevel === 'high', `Risk level evaluated: ${aiData.riskLevel} (Score: ${aiData.riskScore})`);

  // TEST 11: Storage Buckets & Controlled Access
  console.log('\n[TEST 11] Storage Buckets & Controlled Signed URL Generation');
  const bucketsRes = await fetch(`${BASE_URL}/api/v1/storage/buckets`);
  const bucketsData = await bucketsRes.json();
  assert(bucketsRes.status === 200, 'Storage buckets endpoint returns HTTP 200');
  const bucketNames = bucketsData.buckets.map(b => b.name);
  assert(bucketNames.includes('profile-photos'), 'profile-photos bucket active (private)');
  assert(bucketNames.includes('health-documents'), 'health-documents bucket active (private)');
  assert(bucketNames.includes('educational-media'), 'educational-media bucket active (public)');

  const signedUrlRes = await fetch(`${BASE_URL}/api/v1/storage/upload-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      bucket: 'health-documents',
      filename: 'lab_test_fasting_insulin.pdf',
    }),
  });
  const signedUrlData = await signedUrlRes.json();
  assert(signedUrlRes.status === 201, 'Signed upload URL generated with HTTP 201');
  assert(signedUrlData.path.startsWith(`${userId}/`), `Scoped to user directory: ${signedUrlData.path}`);

  // TEST 12: Realtime Publication Inspection
  console.log('\n[TEST 12] Supabase Realtime Replication Verification');
  const realtimeRes = await fetch(`${BASE_URL}/api/v1/realtime/status`);
  const realtimeData = await realtimeRes.json();
  assert(realtimeRes.status === 200, 'Realtime endpoint returns HTTP 200');
  assert(realtimeData.enabledTables.includes('nutrition_logs'), 'nutrition_logs enabled in supabase_realtime');
  assert(realtimeData.enabledTables.includes('symptom_logs'), 'symptom_logs enabled in supabase_realtime');
  assert(realtimeData.enabledTables.includes('goals'), 'goals enabled in supabase_realtime');

  // TEST 13: Secret Leak Protection Audit
  console.log('\n[TEST 13] Secret Protection Audit (No API Keys or Passwords in Responses)');
  const allJsonStrings = [
    JSON.stringify(health),
    JSON.stringify(dbHealth),
    JSON.stringify(signupData),
    JSON.stringify(meData),
    JSON.stringify(mealData),
    JSON.stringify(aiData),
    JSON.stringify(bucketsData),
  ].join(' ');

  const leakedSecrets = [];
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && allJsonStrings.includes(process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    leakedSecrets.push('SUPABASE_SERVICE_ROLE_KEY');
  }
  if (process.env.DATABASE_URL && allJsonStrings.includes(process.env.DATABASE_URL)) {
    leakedSecrets.push('DATABASE_URL');
  }
  if (process.env.GEMINI_API_KEY && allJsonStrings.includes(process.env.GEMINI_API_KEY)) {
    leakedSecrets.push('GEMINI_API_KEY');
  }
  assert(leakedSecrets.length === 0, `No secrets leaked into API responses. Leaked count: ${leakedSecrets.length}`);

  // Summary
  console.log('\n====================================================');
  console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
