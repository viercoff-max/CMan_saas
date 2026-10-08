// Imported FIRST by tests that store encrypted secrets: temp SQLite (engine env) + a test-only APP_SECRET.
import "../../engine/__tests__/env";

if (!process.env.APP_SECRET || process.env.APP_SECRET.length < 16) process.env.APP_SECRET = "unit-test-app-secret-0123456789abcdef";
