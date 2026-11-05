import { z } from "zod";
import { ageFromDob } from "@/lib/money";

/** Zod validation schemas for every endpoint (422 on failure via route wrapper). */

const phoneSchema = z
  .string()
  .min(9)
  .max(20)
  .transform((s) => s.replace(/[\s-]/g, ""));

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72)
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a digit");

const dobSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((d) => ageFromDob(d) >= 18, "You must be at least 18 years old")
  .refine((d) => ageFromDob(d) < 120, "Invalid date of birth");

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const registerSchema = z.object({
  fullName: z.string().min(2).max(80),
  phone: phoneSchema,
  password: passwordSchema,
  dateOfBirth: dobSchema,
  referralCode: z.string().min(4).max(20).optional(),
  language: z.enum(["en", "am", "om"]).optional(),
});

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1).max(72),
});

export const otpSendSchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(["PHONE_VERIFY", "PASSWORD_RESET"]),
});

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().min(4).max(8),
});

export const forgotPasswordSchema = z.object({ phone: phoneSchema });

export const resetPasswordSchema = z.object({
  phone: phoneSchema,
  code: z.string().min(4).max(8),
  newPassword: passwordSchema,
});

// ---------------------------------------------------------------------------
// KYC & profile
// ---------------------------------------------------------------------------

const imageSchema = z
  .string()
  .startsWith("data:image/")
  .max(1_600_000, "Image too large (max ~1.2MB)");

export const kycSchema = z.object({
  docType: z.enum(["FAYDA", "NATIONAL_ID", "PASSPORT", "DRIVING_LICENSE"]),
  docNumber: z.string().min(4).max(30),
  dateOfBirth: dobSchema,
  frontImage: imageSchema,
  backImage: imageSchema.optional(),
});

export const profileUpdateSchema = z.object({
  fullName: z.string().min(2).max(80).optional(),
  language: z.enum(["en", "am", "om"]).optional(),
});

export const limitsSchema = z.object({
  dailyDepositLimitCents: z.number().int().min(0).nullable().optional(),
  dailyStakeLimitCents: z.number().int().min(0).nullable().optional(),
  lossLimitCents: z.number().int().min(0).nullable().optional(),
  coolingOffHours: z.number().int().min(1).max(720).nullable().optional(),
});

export const selfExcludeSchema = z.object({
  days: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90), z.literal(365)]),
  reason: z.string().max(200).optional(),
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const depositSchema = z.object({
  amountCents: z.number().int().min(1, "Amount must be positive").max(10_000_000),
  phone: z.string().optional(), // Chapa mobile-money number; defaults to account phone
});

export const withdrawalSchema = z.object({
  amountCents: z.number().int().min(1, "Amount must be positive"),
  method: z.enum(["TELEBIRR", "CBE_BIRR", "BANK"]),
  accountName: z.string().min(2).max(80),
  accountNumber: z.string().min(6).max(30),
  bankName: z.string().max(60).optional(),
});

// ---------------------------------------------------------------------------
// Betting
// ---------------------------------------------------------------------------

export const placeBetSchema = z.object({
  type: z.enum(["SINGLE", "MULTIPLE", "SYSTEM"]),
  stakeCents: z.number().int().min(1),
  selectionIds: z.array(z.string().min(1)).min(1).max(20),
  systemK: z.number().int().min(2).max(10).optional(),
  acceptOddsChange: z.boolean().optional().default(false),
});

export const cashoutSchema = z.object({}).passthrough();

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const adminUserUpdateSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"]).optional(),
  role: z.enum(["USER", "SUPPORT", "FINANCE", "ADMIN", "SUPER_ADMIN"]).optional(),
  note: z.string().max(300).optional(),
});

export const kycReviewSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  note: z.string().max(300).optional(),
});

export const withdrawalReviewSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  note: z.string().max(300).optional(),
});

export const adminEventCreateSchema = z.object({
  sportKey: z.string().min(2).max(30),
  leagueName: z.string().min(2).max(80),
  homeTeamName: z.string().min(2).max(60),
  awayTeamName: z.string().min(2).max(60),
  startTime: z.string().datetime(),
  featured: z.boolean().optional(),
  withStandardMarkets: z.boolean().optional().default(true),
});

export const adminEventUpdateSchema = z.object({
  status: z.enum(["SCHEDULED", "LIVE", "FINISHED", "POSTPONED", "CANCELLED"]).optional(),
  homeScore: z.number().int().min(0).max(50).nullable().optional(),
  awayScore: z.number().int().min(0).max(50).nullable().optional(),
  minute: z.number().int().min(0).max(130).nullable().optional(),
  featured: z.boolean().optional(),
});

export const adminSettleSchema = z.object({
  homeScore: z.number().int().min(0).max(50),
  awayScore: z.number().int().min(0).max(50),
});

export const adminMarketUpdateSchema = z.object({
  status: z.enum(["OPEN", "SUSPENDED", "SETTLED"]).optional(),
  resultName: z.string().max(20).optional(),
});

export const adminSelectionUpdateSchema = z.object({
  odds: z.number().min(1.01).max(1000).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});

export const adminBonusSchema = z.object({
  name: z.string().min(2).max(60),
  type: z.enum(["WELCOME", "REFERRAL", "DEPOSIT", "MANUAL"]),
  percent: z.number().int().min(1).max(500).optional(),
  maxAmountCents: z.number().int().min(0).optional(),
  fixedCents: z.number().int().min(0).optional(),
  minDepositCents: z.number().int().min(0).optional(),
  minOdds: z.number().min(1).max(100).optional(),
  active: z.boolean().optional(),
  description: z.string().max(300).optional(),
});

export const adminGrantBonusSchema = z.object({
  userId: z.string().min(1),
  amountCents: z.number().int().min(1).max(10_000_000),
  reason: z.string().max(200).optional(),
});

export const adminSettingsUpdateSchema = z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]));
