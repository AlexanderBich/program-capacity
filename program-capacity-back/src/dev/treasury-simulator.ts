import "dotenv/config";
import { randomUUID } from "crypto";
import { CompressionTypes, Kafka, logLevel, Partitioners, Producer } from "kafkajs";
import { MoneyUtils } from "@/common/utils/money.utils";

/**
 * Local stand-in for the external treasury system. It keeps its book in memory and rebuilds it on start
 * by replaying two topics: what the service told it (capacity events, like the real system would hear)
 * and what it published itself. Everything the service consumes from treasury comes from here.
 */

type SimulatedPosition = {
  invoiceCurrency: string;
  invoiceAmountMinor: bigint;
  outstandingInvoiceMinor: bigint;
  outstandingProgramMinor: bigint;
};

type SimulatedProgram = {
  code: string;
  name: string;
  currency: string;
  creditLimitMinor: bigint;
  positions: Map<string, SimulatedPosition>;
};

const FX_PUBLISH_INTERVAL_MS = 5_000;
const ACTIVITY_INTERVAL_MS = 7_000;
const RECONCILIATION_INTERVAL_MS = 30_000;

const CAPACITY_TOPIC = process.env.KAFKA_TOPIC_TREASURY_CAPACITY as string;
const FX_RATES_TOPIC = process.env.KAFKA_TOPIC_TREASURY_FX_RATES as string;
const CAPACITY_EVENTS_TOPIC = process.env.KAFKA_TOPIC_CAPACITY_EVENTS as string;

// A position can be replayed before its program's definition: the two arrive on different topics.
const programs = new Map<string, SimulatedProgram>();

const fxRates = [
  { baseCurrency: "EUR", quoteCurrency: "USD", rate: 1.0812 },
  { baseCurrency: "GBP", quoteCurrency: "USD", rate: 1.2745 },
  { baseCurrency: "USD", quoteCurrency: "JPY", rate: 151.32 },
  { baseCurrency: "USD", quoteCurrency: "KWD", rate: 0.3072 },
  { baseCurrency: "EUR", quoteCurrency: "GBP", rate: 0.8483 },
  { baseCurrency: "EUR", quoteCurrency: "JPY", rate: 163.61 },
  { baseCurrency: "GBP", quoteCurrency: "JPY", rate: 192.86 },
  { baseCurrency: "EUR", quoteCurrency: "KWD", rate: 0.3321 },
];

let lastSequence = 0;
// Millisecond-based, so sequences keep increasing across simulator restarts.
const nextSequence = () => {
  lastSequence = Math.max(Date.now(), lastSequence + 1);
  return lastSequence;
};

const pickRandom = <T>(items: T[]): T | undefined =>
  items[Math.floor(Math.random() * items.length)];

const getOrCreateProgram = (code: string): SimulatedProgram => {
  const existing = programs.get(code);
  if (existing) {
    return existing;
  }
  const created: SimulatedProgram = {
    code,
    name: "",
    currency: "",
    creditLimitMinor: 0n,
    positions: new Map(),
  };
  programs.set(code, created);
  return created;
};

const definedPrograms = () => [...programs.values()].filter((program) => program.currency !== "");

const defineProgram = (
  program: SimulatedProgram,
  details: { name: string; currency: string; creditLimit: string },
) => {
  program.name = details.name;
  program.currency = details.currency;
  program.creditLimitMinor = MoneyUtils.parseToMinorUnits(details.creditLimit, details.currency);
};

const applyCapacityEvent = (event: Record<string, any>) => {
  const program = getOrCreateProgram(event.programCode);

  if (event.type === "PROGRAM_CREATED") {
    defineProgram(program, event as any);
  }
  if (event.type === "CAPACITY_RESERVED") {
    const invoiceMinor = MoneyUtils.parseToMinorUnits(event.invoiceAmount, event.invoiceCurrency);
    program.positions.set(event.invoiceId, {
      invoiceCurrency: event.invoiceCurrency,
      invoiceAmountMinor: invoiceMinor,
      outstandingInvoiceMinor: invoiceMinor,
      outstandingProgramMinor: MoneyUtils.parseToMinorUnits(
        event.programAmount,
        event.programCurrency,
      ),
    });
  }
  if (event.type === "CAPACITY_RELEASED") {
    const position = program.positions.get(event.invoiceId);
    if (!position) {
      return;
    }
    position.outstandingInvoiceMinor -= MoneyUtils.parseToMinorUnits(
      event.invoiceAmount,
      event.invoiceCurrency,
    );
    position.outstandingProgramMinor -= MoneyUtils.parseToMinorUnits(
      event.programAmount,
      event.programCurrency,
    );
    if (position.outstandingInvoiceMinor <= 0n || position.outstandingProgramMinor <= 0n) {
      program.positions.delete(event.invoiceId);
    }
  }
};

/** Replaying what this simulator published earlier. Reconciliations add nothing it does not already track. */
const applyOwnMessage = (message: Record<string, any>) => {
  const program = getOrCreateProgram(message.programCode);

  if (message.type === "PROGRAM_UPSERTED") {
    defineProgram(program, message.payload);
  }
  if (message.type === "CAPACITY_RESERVED" && !program.positions.has(message.payload.invoiceId)) {
    const { invoiceId, invoiceCurrency, invoiceAmount, programAmount } = message.payload;
    const invoiceMinor = MoneyUtils.parseToMinorUnits(invoiceAmount, invoiceCurrency);
    program.positions.set(invoiceId, {
      invoiceCurrency,
      invoiceAmountMinor: invoiceMinor,
      outstandingInvoiceMinor: invoiceMinor,
      // Simulated treasury reservations are always in the program's currency.
      outstandingProgramMinor: MoneyUtils.parseToMinorUnits(programAmount, invoiceCurrency),
    });
  }
  if (message.type === "CAPACITY_RELEASED") {
    program.positions.delete(message.payload.invoiceId);
  }
};

const publishCapacityMessage = (
  producer: Producer,
  program: SimulatedProgram,
  type: string,
  payload: Record<string, unknown>,
) =>
  producer.send({
    topic: CAPACITY_TOPIC,
    compression: CompressionTypes.GZIP,
    messages: [
      {
        key: program.code,
        value: JSON.stringify({
          eventId: randomUUID(),
          type,
          programCode: program.code,
          sequence: nextSequence(),
          occurredAt: new Date().toISOString(),
          payload,
        }),
      },
    ],
  });

const publishFxRates = async (producer: Producer) => {
  for (const fxRate of fxRates) {
    fxRate.rate *= 1 + (Math.random() - 0.5) * 0.001;
  }
  await producer.send({
    topic: FX_RATES_TOPIC,
    messages: fxRates.map((fxRate) => ({
      key: `${fxRate.baseCurrency}/${fxRate.quoteCurrency}`,
      value: JSON.stringify({
        baseCurrency: fxRate.baseCurrency,
        quoteCurrency: fxRate.quoteCurrency,
        rate: fxRate.rate.toFixed(6),
        asOf: new Date().toISOString(),
      }),
    })),
  });
};

const publishLimitChange = async (producer: Producer, program: SimulatedProgram) => {
  // Up or down by 2%, so limit changes show up in a program's activity now and then.
  const stepMinor = (program.creditLimitMinor * 2n) / 100n;
  program.creditLimitMinor += Math.random() < 0.5 ? stepMinor : -stepMinor;
  await publishCapacityMessage(producer, program, "PROGRAM_UPSERTED", {
    name: program.name,
    currency: program.currency,
    creditLimit: MoneyUtils.formatMinorUnits(program.creditLimitMinor, program.currency),
  });
};

/** Reservations and repayments treasury handled on its own: the service only hears about them from here. */
const publishExternalActivity = async (producer: Producer) => {
  const program = pickRandom(definedPrograms());
  if (!program) {
    return;
  }
  if (Math.random() < 0.05) {
    await publishLimitChange(producer, program);
    return;
  }

  const externalPositions = [...program.positions.entries()].filter(([invoiceId]) =>
    invoiceId.startsWith("TRS-"),
  );
  const released = Math.random() < 0.45 ? pickRandom(externalPositions) : undefined;
  if (released) {
    const [invoiceId, position] = released;
    await publishCapacityMessage(producer, program, "CAPACITY_RELEASED", {
      invoiceId,
      repaymentId: `TRS-RPM-${randomUUID()}`,
      amount: MoneyUtils.formatMinorUnits(
        position.outstandingInvoiceMinor,
        position.invoiceCurrency,
      ),
    });
    program.positions.delete(invoiceId);
    return;
  }

  const utilizedMinor = [...program.positions.values()].reduce(
    (total, position) => total + position.outstandingProgramMinor,
    0n,
  );
  // Between 0.5% and 3% of the limit, kept well below it so the demo does not fill programs up.
  const amountMinor =
    (program.creditLimitMinor * BigInt(50 + Math.floor(Math.random() * 250))) / 10000n;
  if (utilizedMinor + amountMinor > (program.creditLimitMinor * 85n) / 100n) {
    return;
  }

  const invoiceId = `TRS-${Date.now().toString(36).toUpperCase()}`;
  const amount = MoneyUtils.formatMinorUnits(amountMinor, program.currency);
  await publishCapacityMessage(producer, program, "CAPACITY_RESERVED", {
    invoiceId,
    invoiceCurrency: program.currency,
    invoiceAmount: amount,
    programAmount: amount,
  });
  program.positions.set(invoiceId, {
    invoiceCurrency: program.currency,
    invoiceAmountMinor: amountMinor,
    outstandingInvoiceMinor: amountMinor,
    outstandingProgramMinor: amountMinor,
  });
};

const publishReconciliations = async (producer: Producer) => {
  for (const program of definedPrograms()) {
    // Treasury re-marks an FX position now and then, so reconciliations visibly correct something.
    const fxPositions = [...program.positions.values()].filter(
      (position) => position.invoiceCurrency !== program.currency,
    );
    const remarked = Math.random() < 0.3 ? pickRandom(fxPositions) : undefined;
    if (remarked) {
      remarked.outstandingProgramMinor +=
        (remarked.outstandingProgramMinor * BigInt(Math.floor(Math.random() * 40) - 20)) / 10000n;
    }

    const totalOutstandingMinor = [...program.positions.values()].reduce(
      (total, position) => total + position.outstandingProgramMinor,
      0n,
    );
    await publishCapacityMessage(producer, program, "PROGRAM_RECONCILED", {
      name: program.name,
      currency: program.currency,
      creditLimit: MoneyUtils.formatMinorUnits(program.creditLimitMinor, program.currency),
      asOf: new Date().toISOString(),
      totalOutstanding: MoneyUtils.formatMinorUnits(totalOutstandingMinor, program.currency),
      positions: [...program.positions.entries()].map(([invoiceId, position]) => ({
        invoiceId,
        invoiceCurrency: position.invoiceCurrency,
        invoiceAmount: MoneyUtils.formatMinorUnits(
          position.invoiceAmountMinor,
          position.invoiceCurrency,
        ),
        outstandingInvoiceAmount: MoneyUtils.formatMinorUnits(
          position.outstandingInvoiceMinor,
          position.invoiceCurrency,
        ),
        outstandingProgramAmount: MoneyUtils.formatMinorUnits(
          position.outstandingProgramMinor,
          program.currency,
        ),
      })),
    });
  }
};

const runEvery = (intervalMs: number, task: () => Promise<void>) => {
  const tick = () => {
    task()
      .catch((error) => console.error("Simulator task failed", error))
      .finally(() => setTimeout(tick, intervalMs));
  };
  setTimeout(tick, intervalMs);
};

async function runSimulator() {
  const kafka = new Kafka({
    clientId: "treasury-simulator",
    brokers: (process.env.KAFKA_BROKERS as string).split(","),
    logLevel: logLevel.WARN,
    retry: { retries: 10 },
  });

  const producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });
  await producer.connect();

  // A fresh group each run, so the whole history rebuilds the in-memory book.
  const consumer = kafka.consumer({ groupId: `treasury-simulator-${randomUUID()}` });
  await consumer.connect();
  await consumer.subscribe({
    topics: [CAPACITY_EVENTS_TOPIC, CAPACITY_TOPIC],
    fromBeginning: true,
  });
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message.value) {
        return;
      }
      const parsed = JSON.parse(message.value.toString("utf8"));
      if (topic === CAPACITY_EVENTS_TOPIC) {
        applyCapacityEvent(parsed);
      } else {
        applyOwnMessage(parsed);
      }
    },
  });

  console.log("Treasury simulator running");
  runEvery(FX_PUBLISH_INTERVAL_MS, () => publishFxRates(producer));
  runEvery(ACTIVITY_INTERVAL_MS, () => publishExternalActivity(producer));
  runEvery(RECONCILIATION_INTERVAL_MS, () => publishReconciliations(producer));
}

void runSimulator();
