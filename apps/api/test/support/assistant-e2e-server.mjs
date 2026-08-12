import 'reflect-metadata';

const providerFailureQuestion = 'How does the assistant choose its sources?';
const providerFailuresDelivered = new Set();

const deterministicProvider = {
  async *stream(input, signal) {
    if (signal.aborted) throw new Error('Assistant aborted');
    const question = input.contents.match(
      /Current user message:\n([\s\S]*?)\n\nPublic documentation excerpts:/u,
    )?.[1];
    if (question?.startsWith(providerFailureQuestion) === true) {
      if (!providerFailuresDelivered.has(question)) {
        providerFailuresDelivered.add(question);
        throw new Error('Deterministic provider failure');
      }
      yield 'The assistant selects public ';
      yield 'documentation sources.';
      return;
    }
    yield 'Sessions use ';
    yield 'protected cookies.';
  },
};

async function bootstrapAssistantE2eServer() {
  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.ASSISTANT_E2E_SERVER !== 'true'
  ) {
    throw new Error('The assistant E2E server is test-only.');
  }

  const [
    { ConfigService },
    { Test },
    { Logger },
    { AppModule },
    { configureApplication, initializeAndListen },
    { ASSISTANT_PROVIDER },
    { ProblemDetailsFilter },
  ] = await Promise.all([
    import('@nestjs/config'),
    import('@nestjs/testing'),
    import('nestjs-pino'),
    import('../../dist/app.module.js'),
    import('../../dist/main.js'),
    import('../../dist/modules/assistant/assistant.types.js'),
    import('../../dist/platform/errors/problem-details.filter.js'),
  ]);

  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ASSISTANT_PROVIDER)
    .useValue(deterministicProvider)
    .compile();
  const app = module.createNestApplication({
    abortOnError: false,
    bodyParser: false,
    logger: false,
  });
  const config = app.get(ConfigService);
  app.useLogger(app.get(Logger));
  configureApplication(
    app,
    {
      TRUST_PROXY_HOPS: config.getOrThrow('TRUST_PROXY_HOPS'),
      SWAGGER_ENABLED: config.getOrThrow('SWAGGER_ENABLED'),
    },
    app.get(ProblemDetailsFilter),
  );
  await initializeAndListen(app, config.getOrThrow('PORT'));
}

void bootstrapAssistantE2eServer().catch(() => {
  process.stderr.write('Assistant E2E server startup failed.\n');
  process.exitCode = 1;
});
