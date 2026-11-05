/**
 * Gadaa Betting — database seed.
 * Run: bun prisma/seed.ts
 *
 * Creates:
 *  - platform settings, sports/leagues/teams (matching mock provider ids)
 *  - staff accounts (super admin / finance / support) + demo player
 *  - promotions (welcome, referral)
 *  - 14 days of synthetic financial history so admin reports have data
 */
import { PrismaClient } from "@prisma/client";
import { LEAGUES } from "../src/lib/sports/mock-provider";

// keep in sync with src/lib/settings.ts DEFAULT_SETTINGS
const DEFAULT_SETTINGS = {
  minDepositCents: 1000,
  maxDepositCents: 5_000_000,
  minWithdrawalCents: 10_000,
  maxWithdrawalCents: 100_000_000,
  withdrawalFeeBps: 0,
  minStakeCents: 500,
  maxStakeCents: 2_000_000,
  maxPotentialWinCents: 100_000_000,
  maxLegs: 20,
  liveBetDelaySeconds: 5,
  cashoutDiscount: 0.85,
  welcomeBonusPercent: 100,
  welcomeBonusMaxCents: 2_000,
  referralBonusCents: 2_000,
  livePollSeconds: 10,
  oddsSyncSeconds: 20,
  fixturesSyncMinutes: 5,
  marketSuspendSeconds: 45,
  provider: "mock",
};

const db = new PrismaClient();

// deterministic PRNG for reproducible synthetic history
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  console.log("🌱 Seeding Gadaa Betting…");

  // ------------------------------------------------------------------ settings
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.setting.upsert({
      where: { key: `platform.${key}` },
      update: {},
      create: { key: `platform.${key}`, valueJson: JSON.stringify(value) },
    });
  }

  // ------------------------------------------------------- sports & catalog
  const sports = new Map<string, string>();
  for (const key of ["football", "basketball"]) {
    const s = await db.sport.upsert({
      where: { key },
      update: {},
      create: { key, name: key === "football" ? "Football" : "Basketball", sortOrder: key === "football" ? 0 : 1 },
    });
    sports.set(key, s.id);
  }
  for (const league of LEAGUES) {
    const l = await db.league.upsert({
      where: { externalId: league.id },
      update: { name: league.name, country: league.country },
      create: {
        externalId: league.id,
        sportId: sports.get(league.sportKey)!,
        name: league.name,
        country: league.country,
        season: "2025",
      },
    });
    for (const team of league.teams) {
      await db.team.upsert({
        where: { externalId: team.id },
        update: { name: team.name },
        create: { externalId: team.id, sportId: sports.get(league.sportKey)!, name: team.name, shortName: team.short },
      });
    }
    console.log(`  ✓ ${league.name} (${league.teams.length} teams)`);
  }

  // ------------------------------------------------------------------- users
  const bcrypt = await import("bcryptjs");
  const hash = (p: string) => bcrypt.hash(p, 10);

  const staff = [
    { phone: "+251911000000", fullName: "Gadaa Super Admin", role: "SUPER_ADMIN", password: "Admin@1234" },
    { phone: "+251911000002", fullName: "Finance Officer", role: "FINANCE", password: "Finance@1234" },
    { phone: "+251911000003", fullName: "Support Agent", role: "SUPPORT", password: "Support@1234" },
  ];
  for (const s of staff) {
    await db.user.upsert({
      where: { phone: s.phone },
      update: { role: s.role },
      create: {
        phone: s.phone,
        fullName: s.fullName,
        role: s.role,
        passwordHash: await hash(s.password),
        phoneVerified: true,
        referralCode: `STAFF${s.phone.slice(-4)}`,
      },
    });
    console.log(`  ✓ staff ${s.role}: ${s.phone} / ${s.password}`);
  }

  const demo = await db.user.upsert({
    where: { phone: "+251911000001" },
    update: {},
    create: {
      phone: "+251911000001",
      fullName: "Demo Player",
      passwordHash: await hash("Test@1234"),
      dateOfBirth: "1995-04-12",
      phoneVerified: true,
      referralCode: "GDEMO123456",
    },
  });
  await db.wallet.upsert({
    where: { userId: demo.id },
    update: {},
    create: { userId: demo.id, balanceCents: 50_000 }, // 500 ETB
  });
  await db.ledgerEntry.create({
    data: {
      walletId: (await db.wallet.findUniqueOrThrow({ where: { userId: demo.id } })).id,
      entryType: "DEPOSIT",
      direction: "CREDIT",
      amountCents: 50_000,
      balanceBeforeCents: 0,
      balanceAfterCents: 50_000,
      counterAccount: "PAYMENTS_CHAPA",
      description: "Welcome deposit (seed)",
    },
  });
  console.log(`  ✓ demo player: +251911000001 / Test@1234 (500 ETB)`);

  // ----------------------------------------------------------------- bonuses
  await db.bonus.upsert({
    where: { id: "bonus-welcome" },
    update: {},
    create: {
      id: "bonus-welcome",
      name: "100% Welcome Bonus",
      type: "WELCOME",
      percent: 100,
      maxAmountCents: DEFAULT_SETTINGS.welcomeBonusMaxCents,
      minDepositCents: 1000,
      active: true,
      description: "Double your first deposit up to 250 ETB",
    },
  });
  await db.bonus.upsert({
    where: { id: "bonus-referral" },
    update: {},
    create: {
      id: "bonus-referral",
      name: "Referral Bonus",
      type: "REFERRAL",
      fixedCents: DEFAULT_SETTINGS.referralBonusCents,
      active: true,
      description: "Earn 50 ETB when a friend makes their first deposit",
    },
  });

  // ---------------------------------------------- synthetic financial history
  // Three "bot" users generate 14 days of deposits/stakes/wins so the admin
  // report charts are populated on first run.
  const r = rng(42);
  for (let i = 0; i < 3; i++) {
    const phone = `+25191200000${i + 1}`;
    const user = await db.user.upsert({
      where: { phone },
      update: {},
      create: {
        phone,
        fullName: `Player ${i + 1}`,
        passwordHash: await hash("Bot@12345"),
        dateOfBirth: "1990-01-01",
        phoneVerified: true,
        referralCode: `BOT${i}00000${i}`,
      },
    });
    const wallet = await db.wallet.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    let balance = 0;
    for (let day = 13; day >= 0; day--) {
      const at = (hour: number) => {
        const d = new Date();
        d.setDate(d.getDate() - day);
        d.setHours(hour, Math.floor(r() * 60), 0, 0);
        return d;
      };
      // 0-2 deposits/day: 20-200 ETB
      const depositCount = Math.floor(r() * 3);
      for (let k = 0; k < depositCount; k++) {
        const amount = Math.round((20 + r() * 180) * 100);
        const before = balance;
        balance += amount;
        const when = at(10 + k * 3);
        await db.deposit.create({
          data: {
            userId: user.id,
            txRef: `GAD-SEED-${i}-${day}-${k}`,
            amountCents: amount,
            status: "SUCCESS",
            creditedAt: when,
            createdAt: when,
          },
        });
        await db.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            entryType: "DEPOSIT",
            direction: "CREDIT",
            amountCents: amount,
            balanceBeforeCents: before,
            balanceAfterCents: balance,
            counterAccount: "PAYMENTS_CHAPA",
            refType: "deposit",
            createdAt: when,
          },
        });
        await db.transaction.create({
          data: { userId: user.id, type: "DEPOSIT", status: "SUCCESS", amountCents: amount, createdAt: when, description: "Chapa deposit (seed history)" },
        });
      }
      // 1-3 bets/day
      const betCount = 1 + Math.floor(r() * 3);
      for (let k = 0; k < betCount; k++) {
        const stake = Math.round((10 + r() * 40) * 100);
        const odds = Math.round((1.6 + r() * 2.4) * 100) / 100;
        const when = at(14 + k);
        if (balance < stake) continue;
        const before = balance;
        balance -= stake;
        await db.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            entryType: "BET_STAKE",
            direction: "DEBIT",
            amountCents: stake,
            balanceBeforeCents: before,
            balanceAfterCents: balance,
            counterAccount: "HOUSE_MAIN",
            refType: "bet",
            createdAt: when,
          },
        });
        // ~52% of bets win
        if (r() < 0.52) {
          const payout = Math.floor(stake * odds);
          const beforeWin = balance;
          balance += payout;
          await db.ledgerEntry.create({
            data: {
              walletId: wallet.id,
              entryType: "BET_WIN",
              direction: "CREDIT",
              amountCents: payout,
              balanceBeforeCents: beforeWin,
              balanceAfterCents: balance,
              counterAccount: "HOUSE_MAIN",
              refType: "bet",
              createdAt: new Date(when.getTime() + 2 * 3_600_000),
            },
          });
        }
      }
    }
    await db.wallet.update({ where: { id: wallet.id }, data: { balanceCents: balance } });
    console.log(`  ✓ history user ${phone}: final balance ${(balance / 100).toFixed(2)} ETB`);
  }

  console.log("✅ Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
