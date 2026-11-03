import { z } from "zod";
import { appConfigSchema } from "@/config/config.schema";

export type AppConfig = z.infer<typeof appConfigSchema>;
