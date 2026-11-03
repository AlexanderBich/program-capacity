export type ErrorConstructor = new (...args: any[]) => Error;

export type HttpErrorMapping = {
  status: number;
  code: string;
  message: string;
  // Forward the application error's metadata to the client. Opt-in, so nothing internal leaks by default.
  exposeMetadata?: boolean;
};

export type MappingEntry = [...ErrorConstructor[], HttpErrorMapping];
