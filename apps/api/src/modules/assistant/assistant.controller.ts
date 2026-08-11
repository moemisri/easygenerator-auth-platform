import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  assistantChatRequestSchema,
  type AssistantChatRequest,
} from '@easygenerator/contracts';

import { CsrfGuard } from '../auth/csrf.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import {
  SessionGuard,
  type AuthenticatedHttpRequest,
} from '../auth/session.guard';
import type { AuthenticatedPrincipal } from '../auth/session.service';
import { AssistantService } from './assistant.service';
import type {
  AssistantRequestEvents,
  AssistantStreamResponse,
} from './assistant.types';

class AssistantChatBody implements AssistantChatRequest {
  static readonly schema = assistantChatRequestSchema;
  message!: string;
  history!: AssistantChatRequest['history'];
}

type AssistantHttpRequest = AuthenticatedHttpRequest & AssistantRequestEvents;

@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, CsrfGuard)
  chat(
    @Body() body: AssistantChatBody,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Req() request: AssistantHttpRequest,
    @Res() response: AssistantStreamResponse,
  ): Promise<void> {
    return this.assistant.chat(
      body,
      { requestId: request.id, userId: principal.user.id },
      request,
      response,
    );
  }
}
