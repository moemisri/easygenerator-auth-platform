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
import { ApiTags } from '@nestjs/swagger';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import {
  SessionGuard,
  type AuthenticatedHttpRequest,
} from '../auth/session.guard.js';
import type { AuthenticatedPrincipal } from '../auth/session.service.js';
import { AssistantService } from './assistant.service.js';
import type {
  AssistantRequestEvents,
  AssistantStreamResponse,
} from './assistant.types.js';
import { ApiAssistantChat } from '../../platform/http/openapi.js';

class AssistantChatBody implements AssistantChatRequest {
  static readonly schema = assistantChatRequestSchema;
  message!: string;
  history!: AssistantChatRequest['history'];
}

type AssistantHttpRequest = AuthenticatedHttpRequest & AssistantRequestEvents;

@Controller('assistant')
@ApiTags('Assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('chat')
  @ApiAssistantChat()
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
