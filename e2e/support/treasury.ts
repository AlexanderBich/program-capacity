import { randomUUID } from 'node:crypto';
import { Kafka, logLevel } from 'kafkajs';

const CAPACITY_TOPIC = 'treasury.capacity.v1';
const FX_RATES_TOPIC = 'treasury.fx-rates.v1';
const DEAD_LETTER_TOPIC = 'treasury.dead-letter.v1';

const kafka = new Kafka({
  clientId: 'program-capacity-e2e',
  brokers: (process.env.E2E_KAFKA_BROKERS ?? 'localhost:19092').split(','),
  logLevel: logLevel.NOTHING,
});

const publish = async (topic: string, key: string, value: string) => {
  const producer = kafka.producer();
  await producer.connect();
  await producer.send({ topic, messages: [{ key, value }] });
  await producer.disconnect();
};

export const publishCapacityMessage = (message: {
  type: 'PROGRAM_UPSERTED' | 'CAPACITY_RESERVED' | 'CAPACITY_RELEASED' | 'PROGRAM_RECONCILED';
  programCode: string;
  sequence: number;
  payload: Record<string, unknown>;
}) =>
  publish(
    CAPACITY_TOPIC,
    message.programCode,
    JSON.stringify({ eventId: randomUUID(), occurredAt: new Date().toISOString(), ...message }),
  );

export const publishMalformedCapacityMessage = (programCode: string, value: string) =>
  publish(CAPACITY_TOPIC, programCode, value);

export const publishFxRate = (rate: {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
}) =>
  publish(
    FX_RATES_TOPIC,
    `${rate.baseCurrency}/${rate.quoteCurrency}`,
    JSON.stringify({ ...rate, asOf: new Date().toISOString() }),
  );

/** Reads the dead-letter topic from the start until a message's content matches. */
export const waitForDeadLetter = async (contains: string, timeoutMs = 30_000) => {
  const consumer = kafka.consumer({ groupId: `program-capacity-e2e-${randomUUID()}` });
  await consumer.connect();
  await consumer.subscribe({ topic: DEAD_LETTER_TOPIC, fromBeginning: true });
  try {
    return await new Promise<{ reason: string }>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`No dead letter containing "${contains}"`)),
        timeoutMs,
      );
      void consumer.run({
        eachMessage: async ({ message }) => {
          if (message.value?.toString().includes(contains)) {
            clearTimeout(timeout);
            resolve({ reason: String(message.headers?.['x-dead-letter-reason']) });
          }
        },
      });
    });
  } finally {
    await consumer.disconnect();
  }
};
