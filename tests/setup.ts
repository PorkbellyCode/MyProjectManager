// 필수 환경 변수의 더미 값. lib/env.ts가 테스트 import 시점에 통과하도록 한다.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-1234";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.BLOB_READ_WRITE_TOKEN ??= "test-blob-token";
process.env.APP_ENCRYPTION_KEY ??= "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
process.env.CRON_SECRET ??= "test-cron-secret";
