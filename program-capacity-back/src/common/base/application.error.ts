export class ApplicationError extends Error {
  constructor(
    message: string,
    readonly metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
