// Provide dummy env so modules that construct the Supabase client can be
// imported in unit tests without a real connection.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
