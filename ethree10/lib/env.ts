import { z } from "zod";

const serverSchema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),

  AUTH_SECRET: z.string().min(1),
  AUTH_URL: z.string().url(),
  NEXTAUTH_URL: z.string().url(),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
  // Web Push. The private key is a server secret; the public one is handed to
  // every browser that subscribes and is not sensitive. Generate a pair with
  // `pnpm exec web-push generate-vapid-keys`. Optional: without them push is a
  // no-op that says so once, rather than a boot failure.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(1),

  REDIS_URL: z.string().min(1),
  CRON_SECRET: z.string().min(20).optional(),

  INTEGRATION_SECRET_KEY: z.string().length(64),

  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_PUBLIC_URL: z.string().url(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_STORAGE_URL: z.string().url(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
});

type ServerEnv = z.infer<typeof serverSchema>;
type ClientEnv = z.infer<typeof clientSchema>;

function parseEnv(): ServerEnv {
  if (process.env["SKIP_ENV_VALIDATION"] === "true") {
    return process.env as unknown as ServerEnv;
  }
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = parsed.error.format();
    console.error("❌ Invalid environment variables:\n", JSON.stringify(formatted, null, 2));
    throw new Error("Invalid environment variables. Check .env.example for required keys.");
  }
  return parsed.data;
}

// Only validate on the server; client gets a subset.
export const env: ServerEnv =
  typeof window === "undefined"
    ? parseEnv()
    : (process.env as unknown as ServerEnv);

export const clientEnv: ClientEnv = clientSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env["NEXT_PUBLIC_APP_URL"],
  NEXT_PUBLIC_STORAGE_URL: process.env["NEXT_PUBLIC_STORAGE_URL"],
  NEXT_PUBLIC_SENTRY_DSN: process.env["NEXT_PUBLIC_SENTRY_DSN"],
});
