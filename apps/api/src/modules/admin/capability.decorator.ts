import { SetMetadata } from '@nestjs/common';

import type { Capability } from './authorization.policy';

export const REQUIRED_CAPABILITY = Symbol('REQUIRED_CAPABILITY');

export const RequireCapability = (capability: Capability) =>
  SetMetadata(REQUIRED_CAPABILITY, capability);
