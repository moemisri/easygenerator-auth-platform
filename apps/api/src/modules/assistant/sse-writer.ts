import {
  assistantSseEventSchema,
  type AssistantSseEvent,
} from '@easygenerator/contracts';

export function encodeSse(event: AssistantSseEvent): string {
  const validated = assistantSseEventSchema.parse(event);
  return `event: ${validated.type}\ndata: ${JSON.stringify(validated.data)}\n\n`;
}
