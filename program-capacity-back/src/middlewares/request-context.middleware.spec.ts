import { Request, Response } from "express";
import { requestMetadataContext } from "@/common/contexts/request-metadata.context";
import { requestContextMiddleware } from "@/middlewares/request-context.middleware";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const handle = (
  incomingRequestId: string | undefined,
  request: { method: string; path: string } = { method: "GET", path: "/api/v1/programs" },
) => {
  const responseHeaders: Record<string, string> = {};
  const seen: { store?: Map<string, string>; calls: number } = { calls: 0 };

  requestContextMiddleware(
    {
      ...request,
      header: (name: string) =>
        name.toLowerCase() === "x-request-id" ? incomingRequestId : undefined,
    } as unknown as Request,
    {
      setHeader: (name: string, value: string) => {
        responseHeaders[name] = value;
      },
    } as unknown as Response,
    () => {
      seen.calls += 1;
      seen.store = requestMetadataContext.getStore();
    },
  );

  return { responseHeaders, store: seen.store, calls: seen.calls };
};

describe("requestContextMiddleware", () => {
  it("keeps a request id the caller sent when it is well formed, and echoes it back", () => {
    const { responseHeaders, store } = handle("client-req_12345");

    expect(responseHeaders["x-request-id"]).toBe("client-req_12345");
    expect(store?.get("requestId")).toBe("client-req_12345");
  });

  it.each([
    ["the shortest allowed id", "a".repeat(8)],
    ["the longest allowed id", "a".repeat(64)],
    ["a UUID", "3f2b8c1e-9d4a-4b6e-8f10-2a7c5d9e1b34"],
    ["letters, digits, underscore and hyphen", "Req_2026-11-01_Zz9"],
  ])("accepts %s", (_description, requestId) => {
    expect(handle(requestId).responseHeaders["x-request-id"]).toBe(requestId);
  });

  it.each([
    ["too short", "a".repeat(7)],
    ["too long", "a".repeat(65)],
    ["empty", ""],
    ["containing a space", "request id 123"],
    ["containing a dot", "request.id.123"],
    ["containing a slash", "request/id/123"],
    [
      "containing a line break, which could split the response headers",
      "abcdefgh\r\nSet-Cookie: x=1",
    ],
    ["containing a non-ASCII character", "requête-id-123"],
    ["containing markup", "<script>alert(1)</script>"],
  ])("replaces an id that is %s with a freshly generated one", (_description, requestId) => {
    const { responseHeaders, store } = handle(requestId);

    expect(responseHeaders["x-request-id"]).toMatch(UUID_PATTERN);
    expect(responseHeaders["x-request-id"]).not.toBe(requestId);
    expect(store?.get("requestId")).toBe(responseHeaders["x-request-id"]);
  });

  it("generates a request id when the caller sent none, a different one each time", () => {
    const first = handle(undefined).responseHeaders["x-request-id"];
    const second = handle(undefined).responseHeaders["x-request-id"];

    expect(first).toMatch(UUID_PATTERN);
    expect(second).toMatch(UUID_PATTERN);
    expect(first).not.toBe(second);
  });

  it("records the method and path of the request alongside the id", () => {
    const { store } = handle(undefined, {
      method: "POST",
      path: "/api/v1/programs/abc/reservations",
    });

    expect(store?.get("method")).toBe("POST");
    expect(store?.get("path")).toBe("/api/v1/programs/abc/reservations");
  });

  it("carries on with the request exactly once, inside the request's context only", () => {
    const { calls, store } = handle(undefined);

    expect(calls).toBe(1);
    expect(store).toBeInstanceOf(Map);
    expect(requestMetadataContext.getStore()).toBeUndefined();
  });

  it("gives each request its own context", () => {
    const first = handle(undefined).store;
    const second = handle(undefined).store;

    expect(first).not.toBe(second);
  });
});
