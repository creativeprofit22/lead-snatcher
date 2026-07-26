import { z } from 'zod';
import { apiKeyServiceSchema } from '@/lib/validations';

export const apiKeySettingsItemSchema = z
  .object({
    service: apiKeyServiceSchema,
    maskedKey: z.string().nullable(),
    hasKey: z.boolean(),
  })
  .strict();

export const apiKeySettingsGetResponseSchema = z.array(apiKeySettingsItemSchema);

export const apiKeySettingsPostSuccessSchema = z
  .object({
    success: z.literal(true),
    service: apiKeyServiceSchema,
    maskedKey: z.string(),
  })
  .strict();

export const apiKeySettingsDeleteSuccessSchema = z
  .object({
    success: z.literal(true),
  })
  .strict();

export const apiErrorResponseSchema = z
  .object({
    error: z.string(),
  })
  .strict();

export type ApiKeySettingsItem = z.infer<typeof apiKeySettingsItemSchema>;
export type ApiKeySettingsGetResponse = z.infer<typeof apiKeySettingsGetResponseSchema>;
export type ApiKeySettingsPostSuccess = z.infer<typeof apiKeySettingsPostSuccessSchema>;
export type ApiKeySettingsDeleteSuccess = z.infer<typeof apiKeySettingsDeleteSuccessSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
