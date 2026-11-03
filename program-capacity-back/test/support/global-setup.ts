import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Kafka, logLevel } from "kafkajs";
import { join } from "path";
import { GenericContainer, Wait } from "testcontainers";
import { DataSource } from "typeorm";

const KAFKA_HOST_PORT = 59092;

export default async function globalSetup() {
  const postgres = await new PostgreSqlContainer("postgres:16-alpine").start();
  process.env.DB_HOST = postgres.getHost();
  process.env.DB_PORT = String(postgres.getPort());
  process.env.DB_USER = postgres.getUsername();
  process.env.DB_PASS = postgres.getPassword();
  process.env.DB_NAME = postgres.getDatabase();

  const dataSource = new DataSource({
    type: "postgres",
    url: postgres.getConnectionUri(),
    uuidExtension: "pgcrypto",
    installExtensions: false,
    migrations: [join(__dirname, "../../src/migrations/*.ts")],
    migrationsTableName: "typeorm_migrations",
  });
  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();

  // The port is fixed because a broker must advertise the address clients reach it on.
  const kafka = await new GenericContainer("apache/kafka:3.9.1")
    .withExposedPorts({ container: KAFKA_HOST_PORT, host: KAFKA_HOST_PORT })
    .withEnvironment({
      KAFKA_NODE_ID: "1",
      KAFKA_PROCESS_ROLES: "broker,controller",
      KAFKA_LISTENERS: `EXTERNAL://:${KAFKA_HOST_PORT},INTERNAL://:29092,CONTROLLER://:9093`,
      KAFKA_ADVERTISED_LISTENERS: `EXTERNAL://localhost:${KAFKA_HOST_PORT},INTERNAL://localhost:29092`,
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP:
        "CONTROLLER:PLAINTEXT,INTERNAL:PLAINTEXT,EXTERNAL:PLAINTEXT",
      KAFKA_CONTROLLER_LISTENER_NAMES: "CONTROLLER",
      KAFKA_INTER_BROKER_LISTENER_NAME: "INTERNAL",
      KAFKA_CONTROLLER_QUORUM_VOTERS: "1@localhost:9093",
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: "1",
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: "1",
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: "1",
      KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: "0",
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false",
    })
    .withWaitStrategy(Wait.forLogMessage(/Kafka Server started/))
    .withStartupTimeout(120_000)
    .start();
  process.env.KAFKA_BROKERS = `localhost:${KAFKA_HOST_PORT}`;

  const admin = new Kafka({
    brokers: [process.env.KAFKA_BROKERS],
    logLevel: logLevel.NOTHING,
    retry: { retries: 10 },
  }).admin();
  await admin.connect();
  await admin.createTopics({
    waitForLeaders: true,
    topics: [
      "treasury.capacity.test",
      "treasury.fx-rates.test",
      "treasury.dead-letter.test",
      "program-capacity.events.test",
    ].map((topic) => ({ topic, numPartitions: 3, replicationFactor: 1 })),
  });
  await admin.disconnect();

  Object.assign(globalThis, { testContainers: [postgres, kafka] });
}
