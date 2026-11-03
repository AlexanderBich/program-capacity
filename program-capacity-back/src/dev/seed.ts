import { NestFactory } from "@nestjs/core";
import { hash } from "@node-rs/argon2";
import { randomUUID } from "crypto";
import { SeedModule } from "@/dev/seed.module";
import { UserRole } from "@/modules/auth/auth.enums";
import { UserRepository } from "@/modules/auth/infrastructure/repositories/user.repository";
import { ProgramCreationService } from "@/modules/capacity/application/services/program-creation.service";
import { ReservationReleaseService } from "@/modules/capacity/application/services/reservation-release.service";
import { ReservationService } from "@/modules/capacity/application/services/reservation.service";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";
import { FxFacade } from "@/modules/fx/fx.facade";

const SEED_ACTOR = "seed@capacity.local";

const USERS = [
  { email: "admin@capacity.local", role: UserRole.ADMIN },
  { email: "operator@capacity.local", role: UserRole.OPERATOR },
  { email: "viewer@capacity.local", role: UserRole.VIEWER },
];

const FX_RATES = [
  { baseCurrency: "EUR", quoteCurrency: "USD", rate: "1.0812" },
  { baseCurrency: "GBP", quoteCurrency: "USD", rate: "1.2745" },
  { baseCurrency: "USD", quoteCurrency: "JPY", rate: "151.32" },
  { baseCurrency: "USD", quoteCurrency: "KWD", rate: "0.3072" },
  { baseCurrency: "EUR", quoteCurrency: "GBP", rate: "0.8483" },
  { baseCurrency: "EUR", quoteCurrency: "JPY", rate: "163.61" },
  { baseCurrency: "GBP", quoteCurrency: "JPY", rate: "192.86" },
  { baseCurrency: "EUR", quoteCurrency: "KWD", rate: "0.3321" },
];

const PROGRAMS = [
  {
    code: "ACME-USD",
    name: "Acme Supply Chain Finance",
    currency: "USD",
    creditLimit: "10000000.00",
    invoices: [
      { invoiceId: "ACME-INV-1001", amount: "1250000.00", currency: "USD", repaid: "1250000.00" },
      { invoiceId: "ACME-INV-1002", amount: "860400.50", currency: "USD", repaid: "200000.00" },
      { invoiceId: "ACME-INV-1003", amount: "742000.00", currency: "EUR" },
      { invoiceId: "ACME-INV-1004", amount: "310500.00", currency: "GBP" },
      { invoiceId: "ACME-INV-1005", amount: "1995000.00", currency: "USD" },
      { invoiceId: "ACME-INV-1006", amount: "48000000", currency: "JPY" },
    ],
  },
  {
    code: "NORDIC-EUR",
    name: "Nordic Receivables Facility",
    currency: "EUR",
    creditLimit: "6500000.00",
    invoices: [
      { invoiceId: "NORD-INV-2201", amount: "2100000.00", currency: "EUR" },
      { invoiceId: "NORD-INV-2202", amount: "1450000.00", currency: "USD", repaid: "450000.00" },
      { invoiceId: "NORD-INV-2203", amount: "980000.00", currency: "EUR" },
    ],
  },
  {
    code: "ORIENT-JPY",
    name: "Orient Trade Program",
    currency: "JPY",
    creditLimit: "900000000",
    invoices: [
      { invoiceId: "ORNT-INV-3301", amount: "410000000", currency: "JPY" },
      { invoiceId: "ORNT-INV-3302", amount: "1200000.00", currency: "USD" },
      { invoiceId: "ORNT-INV-3303", amount: "95000000", currency: "JPY", repaid: "95000000" },
    ],
  },
  {
    code: "GULF-KWD",
    name: "Gulf Treasury Line",
    currency: "KWD",
    creditLimit: "1500000.000",
    invoices: [
      { invoiceId: "GULF-INV-4401", amount: "1150000.000", currency: "KWD" },
      { invoiceId: "GULF-INV-4402", amount: "850000.00", currency: "USD" },
    ],
  },
];

/** Demo data for local runs. Idempotent, and goes through the real services so all invariants hold. */
async function seed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed demo data in production");
  }

  const app = await NestFactory.createApplicationContext(SeedModule, { logger: ["error", "warn"] });

  const passwordHash = await hash(process.env.SEED_PASSWORD as string);
  for (const user of USERS) {
    await app.get(UserRepository, { strict: false }).insertIfEmailAbsent({
      ...user,
      passwordHash,
      isActive: true,
    });
  }

  const existingCodes = new Set(
    (await app.get(ProgramRepository, { strict: false }).findManyOrderedByCode()).map(
      (program) => program.code,
    ),
  );
  // Only on a fresh database: later on, these would overwrite newer rates from the treasury feed.
  if (existingCodes.size === 0) {
    for (const rate of FX_RATES) {
      await app.get(FxFacade, { strict: false }).applyPublishedRate({ ...rate, asOf: new Date() });
    }
  }

  for (const { invoices, ...programInput } of PROGRAMS) {
    if (existingCodes.has(programInput.code)) {
      continue;
    }
    const program = await app
      .get(ProgramCreationService, { strict: false })
      .createProgram({ ...programInput, actor: SEED_ACTOR });

    for (const { repaid, ...invoice } of invoices) {
      const { reservation } = await app
        .get(ReservationService, { strict: false })
        .reserve({ programId: program.id, ...invoice, actor: SEED_ACTOR });
      if (repaid) {
        await app.get(ReservationReleaseService, { strict: false }).releaseViaApi({
          programId: program.id,
          reservationId: reservation.id,
          repaymentId: `SEED-${randomUUID()}`,
          amount: repaid,
          currency: invoice.currency,
          actor: SEED_ACTOR,
        });
      }
    }
  }

  await app.close();
}

void seed();
