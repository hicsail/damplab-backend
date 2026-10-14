import { showBiosecurityFromAttributes } from './keycloak.service';

describe('showBiosecurityFromAttributes', () => {
  it('shows the block when the account has no attribute', () => {
    expect(showBiosecurityFromAttributes(undefined)).toBe(true);
    expect(showBiosecurityFromAttributes({})).toBe(true);
    expect(showBiosecurityFromAttributes({ showBiosecurity: [] })).toBe(true);
  });

  it('hides the block only when an admin stored false', () => {
    expect(showBiosecurityFromAttributes({ showBiosecurity: ['false'] })).toBe(false);
    expect(showBiosecurityFromAttributes({ showBiosecurity: ['true'] })).toBe(true);
  });
});
