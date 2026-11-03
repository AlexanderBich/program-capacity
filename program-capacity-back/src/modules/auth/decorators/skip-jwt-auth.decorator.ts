import { SetMetadata } from "@nestjs/common";
import { SKIP_JWT_AUTH_METADATA_KEY } from "@/modules/auth/auth.constants";

/**
 * JWT auth is global and on by default. This opts a route out of the JWT check only: every route using
 * it must authenticate its caller another way (credentials, refresh cookie, probe token).
 */
export const SkipJwtAuth = () => SetMetadata(SKIP_JWT_AUTH_METADATA_KEY, true);
