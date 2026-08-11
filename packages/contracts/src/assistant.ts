import { z } from 'zod';

export const assistantHistoryItemSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const assistantChatRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(1_000),
    history: z.array(assistantHistoryItemSchema).max(6).default([]),
  })
  .strict()
  .superRefine(({ history }, context) => {
    if (history.reduce((sum, item) => sum + item.content.length, 0) > 6_000) {
      context.addIssue({
        code: 'custom',
        path: ['history'],
        message: 'History is too long.',
      });
    }
  });

export const assistantSourceSchema = z
  .object({
    id: z.string().min(1),
    file: z.string().min(1),
    heading: z.string().min(1),
  })
  .strict();

export const assistantSseEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('sources'),
      data: z
        .object({ sources: z.array(assistantSourceSchema).max(4) })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('delta'),
      data: z.object({ text: z.string().min(1).max(8_192) }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('done'),
      data: z.object({ outcome: z.enum(['answered', 'refused']) }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('error'),
      data: z
        .object({
          code: z.enum(['ASSISTANT_TIMEOUT', 'ASSISTANT_PROVIDER_UNAVAILABLE']),
          message: z.string().min(1).max(160),
        })
        .strict(),
    })
    .strict(),
]);

export type AssistantHistoryItem = z.infer<typeof assistantHistoryItemSchema>;
export type AssistantChatRequest = z.infer<typeof assistantChatRequestSchema>;
export type AssistantSource = z.infer<typeof assistantSourceSchema>;
export type AssistantSseEvent = z.infer<typeof assistantSseEventSchema>;
