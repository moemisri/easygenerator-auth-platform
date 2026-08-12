import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { validateRenderBlueprint } from '../../../../scripts/validate-render-blueprint.mjs';

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['services'],
  properties: {
    services: {
      type: 'array',
      minItems: 2,
      items: { type: 'object', required: ['type', 'name'] },
    },
  },
};

describe('official Render schema validator', () => {
  it('fetches only the published schema and validates local YAML', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-render-'));
    try {
      const blueprint = path.join(directory, 'render.yaml');
      fs.writeFileSync(
        blueprint,
        'services:\n  - type: keyvalue\n    name: cache\n  - type: web\n    name: app\n',
      );
      const fetcher = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(schema)));

      await expect(
        validateRenderBlueprint(blueprint, fetcher),
      ).resolves.toBeUndefined();
      expect(fetcher).toHaveBeenCalledWith(
        'https://render.com/schema/render.yaml.json',
        {
          headers: { accept: 'application/schema+json, application/json' },
          signal: expect.any(AbortSignal),
        },
      );
      expect(fetcher).toHaveBeenCalledOnce();
    } finally {
      fs.rmSync(directory, { recursive: true });
    }
  });

  it('uses stable categories for schema and network failures', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-render-'));
    try {
      const blueprint = path.join(directory, 'render.yaml');
      fs.writeFileSync(blueprint, 'services: []\n');
      await expect(
        validateRenderBlueprint(
          blueprint,
          async () => new Response(JSON.stringify(schema)),
        ),
      ).rejects.toThrow('BLUEPRINT_SCHEMA_INVALID');
      await expect(
        validateRenderBlueprint(blueprint, async () => {
          throw new Error('private-network-marker');
        }),
      ).rejects.toThrow('SCHEMA_FETCH_FAILED');
    } finally {
      fs.rmSync(directory, { recursive: true });
    }
  });
});
