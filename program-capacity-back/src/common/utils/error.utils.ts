import { HttpException } from "@nestjs/common";
import { ApplicationError } from "@/common/base/application.error";
import { ErrorConstructor, HttpErrorMapping, MappingEntry } from "@/common/utils/error-utils.types";

export class ErrorUtils {
  static mapErrorsToHttpOrThrow(err: unknown, mappings: MappingEntry[]): never {
    for (const entry of mappings) {
      const httpInfo = entry[entry.length - 1] as HttpErrorMapping;
      const errorClasses = entry.slice(0, -1) as ErrorConstructor[];

      for (const ErrorClass of errorClasses) {
        if (err instanceof ErrorClass) {
          throw new HttpException(
            {
              statusCode: httpInfo.status,
              code: httpInfo.code,
              message: httpInfo.message,
              ...(httpInfo.exposeMetadata && err instanceof ApplicationError
                ? { details: err.metadata }
                : {}),
            },
            httpInfo.status,
          );
        }
      }
    }

    throw err;
  }
}
