import { paramValuesSemanticallyEqual } from './param-values.util';

describe('paramValuesSemanticallyEqual — JSON held in a string', () => {
  it('treats a stored JSON string as equal to the same object in another key order', () => {
    expect(paramValuesSemanticallyEqual('{"sampleCount":2,"key":"k","filename":"a.csv"}', { key: 'k', filename: 'a.csv', sampleCount: 2 })).toBe(true);
  });

  it('still tells a genuinely different value apart', () => {
    expect(paramValuesSemanticallyEqual('{"filename":"a.csv","key":"k","sampleCount":2}', { key: 'other', filename: 'a.csv', sampleCount: 2 })).toBe(false);
  });

  it('leaves plain and non-object JSON strings alone', () => {
    expect(paramValuesSemanticallyEqual('hello', 'hello')).toBe(true);
    expect(paramValuesSemanticallyEqual('hello', 'world')).toBe(false);
    expect(paramValuesSemanticallyEqual('12', 12)).toBe(true);
    expect(paramValuesSemanticallyEqual('{not json', '{not json')).toBe(true);
    expect(paramValuesSemanticallyEqual('{not json', { a: 1 })).toBe(false);
  });
});
