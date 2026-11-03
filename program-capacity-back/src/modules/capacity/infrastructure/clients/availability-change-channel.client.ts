import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client } from "pg";
import { Subject } from "rxjs";
import { EntityManager } from "typeorm";
import { Nullable } from "@/common/types/common";
import {
  AVAILABILITY_CHANNEL_HEALTH_CHECK_INTERVAL_MS,
  AVAILABILITY_CHANNEL_HEALTH_CHECK_TIMEOUT_MS,
  AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS,
  AVAILABILITY_NOTIFICATION_CHANNEL,
} from "@/modules/capacity/capacity.constants";
import { AvailabilityChangeNotification } from "@/modules/capacity/capacity.types";
import { LoggerService } from "@/modules/logger/logger.service";

/**
 * PostgreSQL LISTEN/NOTIFY as the fan-out between API replicas. NOTIFY is transactional: subscribers hear
 * about a change only if and after it commits, which no external pub/sub could guarantee without an outbox.
 */
@Injectable()
export class AvailabilityChangeChannelClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger: LoggerService;
  private readonly changesSubject = new Subject<AvailabilityChangeNotification>();
  private readonly reconnectedSubject = new Subject<void>();
  private listener: Nullable<Client> = null;
  private reconnectTimer: Nullable<NodeJS.Timeout> = null;
  private healthCheckTimer: Nullable<NodeJS.Timeout> = null;
  private isStopping = false;

  readonly changes$ = this.changesSubject.asObservable();
  // Notifications sent while disconnected are gone, so subscribers must re-read state after this fires.
  readonly reconnected$ = this.reconnectedSubject.asObservable();

  constructor(
    private readonly config: ConfigService,
    private readonly baseLogger: LoggerService,
  ) {
    this.logger = this.baseLogger.forContext(AvailabilityChangeChannelClient.name);
  }

  async onModuleInit(): Promise<void> {
    await this.connectListener({ isReconnect: false });
  }

  async onModuleDestroy(): Promise<void> {
    this.isStopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.stopHealthCheck();
    await this.listener?.end();
    this.changesSubject.complete();
    this.reconnectedSubject.complete();
  }

  async publishInTransaction(
    manager: EntityManager,
    change: AvailabilityChangeNotification,
  ): Promise<void> {
    await manager.query("SELECT pg_notify($1, $2)", [
      AVAILABILITY_NOTIFICATION_CHANNEL,
      JSON.stringify(change),
    ]);
  }

  private async connectListener(params: { isReconnect: boolean }): Promise<void> {
    const client = new Client({
      host: this.config.getOrThrow<string>("database.host"),
      port: this.config.getOrThrow<number>("database.port"),
      user: this.config.getOrThrow<string>("database.user"),
      password: this.config.getOrThrow<string>("database.pass"),
      database: this.config.getOrThrow<string>("database.name"),
      ssl: this.config.getOrThrow<boolean>("database.ssl") ? { rejectUnauthorized: true } : false,
      keepAlive: true,
    });

    client.on("notification", (message) => this.deliverNotification(message.payload));
    client.on("error", (error) => {
      this.logger.error("Availability channel connection failed", { error });
    });
    client.once("end", () => {
      this.stopHealthCheck();
      this.scheduleReconnect();
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${AVAILABILITY_NOTIFICATION_CHANNEL}`);
      if (this.isStopping) {
        await client.end();
        return;
      }
      this.listener = client;
      this.healthCheckTimer = setInterval(
        () => void this.checkListenerHealth(client),
        AVAILABILITY_CHANNEL_HEALTH_CHECK_INTERVAL_MS,
      );
      this.healthCheckTimer.unref();
      if (params.isReconnect) {
        this.reconnectedSubject.next();
      }
    } catch (error) {
      this.logger.error("Could not subscribe to the availability channel", { error });
      await client.end().catch(() => undefined);
    }
  }

  private scheduleReconnect(): void {
    if (this.isStopping) {
      return;
    }
    this.reconnectTimer = setTimeout(
      () => void this.connectListener({ isReconnect: true }),
      AVAILABILITY_CHANNEL_RECONNECT_DELAY_MS,
    );
  }

  /**
   * A connection that dies without a word, as in a failover, fires no event for hours, while streams keep
   * their heartbeats and show stale figures as live. So this one is asked, and replaced when it stops
   * answering. Reconnecting makes subscribers re-read what they missed.
   */
  private async checkListenerHealth(client: Client): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        client.query("SELECT 1"),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("The availability channel did not answer in time")),
            AVAILABILITY_CHANNEL_HEALTH_CHECK_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      this.logger.error("Availability channel stopped answering, replacing it", { error });
      this.stopHealthCheck();
      client.removeAllListeners("end");
      // Not awaited: ending a dead connection can hang for as long as the operating system lets it.
      client.end().catch(() => undefined);
      this.scheduleReconnect();
    } finally {
      clearTimeout(timeout);
    }
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Whoever can reach the database can NOTIFY this channel, and an exception thrown from this listener would
   * be uncaught and take the process down. A change it cannot read is only a missed update: the next one heals.
   */
  private deliverNotification(payload: string | undefined): void {
    if (!payload) {
      return;
    }
    try {
      const change = JSON.parse(payload);
      if (typeof change?.programId !== "string" || typeof change?.version !== "number") {
        throw new Error("Not an availability change");
      }
      this.changesSubject.next(change);
    } catch (error) {
      this.logger.error("Ignoring a malformed availability notification", { error, payload });
    }
  }
}
