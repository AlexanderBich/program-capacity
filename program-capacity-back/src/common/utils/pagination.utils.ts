export class PaginationUtils {
  static toOffset(params: { page: number; limit: number }): number {
    return (params.page - 1) * params.limit;
  }
}
