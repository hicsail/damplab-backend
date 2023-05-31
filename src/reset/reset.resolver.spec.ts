import { Test, TestingModule } from '@nestjs/testing';
import { ResetResolver } from './reset.resolver';

describe('ResetResolver', () => {
  let resolver: ResetResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ResetResolver]
    }).compile();

    resolver = module.get<ResetResolver>(ResetResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
