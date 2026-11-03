export type SseEvent = { type: string; id?: string; data: any };

/** Minimal fetch-based SSE client, the way a browser client must do it to send an Authorization header. */
export class SseClient {
  readonly events: SseEvent[] = [];
  isClosedByServer = false;
  private readonly abortController = new AbortController();
  private readonly waiters: { predicate: (event: SseEvent) => boolean; resolve: () => void }[] = [];

  private constructor(readonly status: number) {}

  static async open(url: string, token: string): Promise<SseClient> {
    const abortController = new AbortController();
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
      signal: abortController.signal,
    });
    const client = new SseClient(response.status);
    client.abortController.signal.addEventListener("abort", () => abortController.abort());
    if (response.ok && response.body) {
      void client.readLoop(response.body);
    }
    return client;
  }

  waitForEvent(predicate: (event: SseEvent) => boolean, timeoutMs = 10_000): Promise<void> {
    if (this.events.some(predicate)) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out; received ${JSON.stringify(this.events)}`)),
        timeoutMs,
      );
      this.waiters.push({
        predicate,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });
  }

  async waitForServerClose(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.isClosedByServer) {
      if (Date.now() > deadline) {
        throw new Error("Server did not close the stream");
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  close(): void {
    this.abortController.abort();
  }

  private async readLoop(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          this.isClosedByServer = true;
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let separator = buffer.indexOf("\n\n");
        while (separator !== -1) {
          this.handleFrame(buffer.slice(0, separator));
          buffer = buffer.slice(separator + 2);
          separator = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // Aborted by close().
    }
  }

  private handleFrame(frame: string): void {
    const event: SseEvent = { type: "message", data: undefined };
    for (const line of frame.split("\n")) {
      if (line.startsWith("event: ")) {
        event.type = line.slice(7);
      } else if (line.startsWith("id: ")) {
        event.id = line.slice(4);
      } else if (line.startsWith("data: ")) {
        event.data = JSON.parse(line.slice(6));
      }
    }
    this.events.push(event);
    for (const waiter of this.waiters.filter(({ predicate }) => predicate(event))) {
      waiter.resolve();
    }
  }
}
