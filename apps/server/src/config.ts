import { z } from 'zod';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Load configuration from the project-root .env file.
dotenv.config({
  path: fileURLToPath(new URL('../../../.env', import.meta.url)),
});

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  BHARAT_MILAN_JWT_SECRET: z.string().trim().optional(),

  // Bharat Milan API used to resolve the signed-in member's real profile name.
  BHARAT_MILAN_API_URL: z
    .string()
    .url()
    .default('https://bharat-milan-api.onrender.com'),

  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  DEMO_ELIGIBILITY_MODE: z.enum(['true', 'false']).default('false'),

  // Cloudinary credentials
  CLOUDINARY_CLOUD_NAME: z.string().trim().optional(),
  CLOUDINARY_API_KEY: z.string().trim().optional(),
  CLOUDINARY_API_SECRET: z.string().trim().optional(),
  CLOUDINARY_SIGNED_URL_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(30)
    .max(900)
    .default(300),

  MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(10_485_760),
  MAX_VIDEO_BYTES: z.coerce.number().int().positive().default(104_857_600),

  BHARAT_MILAN_ELIGIBILITY_URL: z
    .string()
    .transform(value => value.trim() || undefined)
    .pipe(z.string().url().optional()),

  BHARAT_MILAN_SERVICE_TOKEN: z
    .string()
    .transform(value => value.trim() || undefined)
    .pipe(z.string().min(32).optional()),
});

export const config = schema.parse(process.env);

if (
  config.NODE_ENV === 'production' &&
  (config.DEMO_MODE === 'true' || config.DEMO_ELIGIBILITY_MODE === 'true')
) {
  throw new Error('Demo features are forbidden in production');
}
