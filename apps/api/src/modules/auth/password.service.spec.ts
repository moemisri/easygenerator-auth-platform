import { describe, expect, it } from 'vitest';

import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes passwords with the required Argon2id cost parameters', async () => {
    const hash = await service.hash('Secure1!');

    expect(hash).toMatch(/^\$argon2id\$v=19\$/);
    expect(new Set(hash.split('$')[3]?.split(','))).toEqual(
      new Set(['m=19456', 't=2', 'p=1']),
    );
    expect(hash).not.toContain('Secure1!');
    await expect(service.verify(hash, 'Secure1!')).resolves.toBe(true);
  });

  it('returns false when the password does not match', async () => {
    const hash = await service.hash('Secure1!');

    await expect(service.verify(hash, 'Incorrect1!')).resolves.toBe(false);
  });

  it.each(['', 'not-an-argon-hash', '$argon2id$malformed'])(
    'fails closed for malformed hash %j',
    async (hash) => {
      await expect(service.verify(hash, 'Secure1!')).resolves.toBe(false);
    },
  );
});
