import { AsyncLocalStorage } from "async_hooks";

export const requestMetadataContext = new AsyncLocalStorage<Map<string, string>>();
