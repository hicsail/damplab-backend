import { checkValue, effectiveValidation, parameterDefinitionError, parseValidation, ruleMessage, ValidationRule } from './parameter-validation';

const rules = (text: string): ValidationRule[] => {
  const parsed = parseValidation(text);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed.rules;
};

describe('parseValidation (rule 22)', () => {
  it('reads rules joined by &&, ignoring whitespace and case', () => {
    expect(parseValidation('>0 && <100 && integer')).toEqual({ rules: [{ kind: 'gt', n: 0 }, { kind: 'lt', n: 100 }, { kind: 'integer' }] });
    expect(parseValidation(' >= -1.5&&<=2 && INTEGER ')).toEqual({ rules: [{ kind: 'gte', n: -1.5 }, { kind: 'lte', n: 2 }, { kind: 'integer' }] });
  });

  it('reads blank as no rules', () => {
    expect(parseValidation('')).toEqual({ rules: [] });
    expect(parseValidation('   ')).toEqual({ rules: [] });
    expect(parseValidation(undefined)).toEqual({ rules: [] });
  });

  it('names || as unsupported', () => {
    expect(parseValidation('>0 || <5')).toEqual({ error: '“||” is not supported — join rules with &&.' });
  });

  it('names any other token', () => {
    expect(parseValidation('>0 && positive')).toEqual({ error: '“positive” is not a rule. Use >n, >=n, <n, <=n or integer.' });
    expect(parseValidation('=5')).toEqual({ error: '“=5” is not a rule. Use >n, >=n, <n, <=n or integer.' });
    expect(parseValidation('>abc')).toEqual({ error: '“>abc” is not a rule. Use >n, >=n, <n, <=n or integer.' });
  });

  it('refuses a dangling &&', () => {
    expect(parseValidation('>0 &&')).toEqual({ error: 'A rule is missing next to “&&”.' });
  });
});

describe('ruleMessage', () => {
  it('uses the pinned sentences', () => {
    expect(ruleMessage({ kind: 'gt', n: 0 })).toBe('Must be greater than 0');
    expect(ruleMessage({ kind: 'gte', n: 1 })).toBe('Must be at least 1');
    expect(ruleMessage({ kind: 'lt', n: 100 })).toBe('Must be less than 100');
    expect(ruleMessage({ kind: 'lte', n: 2.5 })).toBe('Must be at most 2.5');
    expect(ruleMessage({ kind: 'integer' })).toBe('Must be a whole number');
  });
});

describe('checkValue', () => {
  it('returns the first broken rule, or null', () => {
    expect(checkValue(rules('>0 && <100 && integer'), 5)).toBeNull();
    expect(checkValue(rules('>0 && <100 && integer'), 0)).toBe('Must be greater than 0');
    expect(checkValue(rules('>0 && <100 && integer'), 100)).toBe('Must be less than 100');
    expect(checkValue(rules('>0 && <100 && integer'), 2.5)).toBe('Must be a whole number');
    expect(checkValue(rules('>=1 && <=3'), 1)).toBeNull();
    expect(checkValue(rules('>=1 && <=3'), 3)).toBeNull();
    expect(checkValue(rules('>=1 && <=3'), 3.01)).toBe('Must be at most 3');
  });

  it('never complains about an empty value — "required" is a different rule', () => {
    for (const empty of [null, undefined, '']) expect(checkValue(rules('>0'), empty)).toBeNull();
  });

  it('reads a number typed as text, and refuses text that is not a number (Review Focus 4)', () => {
    expect(checkValue(rules('integer'), ' 5 ')).toBeNull();
    expect(checkValue(rules('integer'), '5.0')).toBeNull();
    expect(checkValue(rules('>0'), 'abc')).toBe('Must be a number');
  });

  it('has nothing to say when there are no rules', () => {
    expect(checkValue([], 'abc')).toBeNull();
  });
});

describe('effectiveValidation (rule 24)', () => {
  it('prefers the stored validation', () => {
    expect(effectiveValidation({ validation: ' >0 ', rangeValueMin: 5 })).toBe('>0');
  });
  it('falls back to the legacy min/max', () => {
    expect(effectiveValidation({ rangeValueMin: 1, rangeValueMax: 10 })).toBe('>=1 && <=10');
    expect(effectiveValidation({ rangeValueMin: 0 })).toBe('>=0');
    expect(effectiveValidation({ rangeValueMax: 3 })).toBe('<=3');
  });
  it('is blank when there is neither', () => {
    expect(effectiveValidation({})).toBe('');
    expect(effectiveValidation(null)).toBe('');
    expect(effectiveValidation({ validation: '  ' })).toBe('');
  });
});

describe('parameterDefinitionError', () => {
  it('accepts a parameter with neither new field', () => {
    expect(parameterDefinitionError({ id: 'a', name: 'A', type: 'string' })).toBeNull();
  });
  it('accepts a parseable validation on a number', () => {
    expect(parameterDefinitionError({ id: 'n', name: 'Cycles', type: 'number', validation: '>0 && integer' })).toBeNull();
  });
  it('refuses an unparseable validation, naming the parameter', () => {
    expect(parameterDefinitionError({ id: 'n', name: 'Cycles', type: 'number', validation: '>0 || <5' })).toBe('Parameter “Cycles”: “||” is not supported — join rules with &&.');
  });
  it('refuses a validation on a non-number', () => {
    expect(parameterDefinitionError({ id: 't', name: 'Notes', type: 'string', validation: '>0' })).toBe('Parameter “Notes”: only Number parameters can have a validation.');
  });
  it('accepts checkboxes on a multi-value dropdown only', () => {
    expect(parameterDefinitionError({ id: 'd', name: 'Type', type: 'dropdown', allowMultipleValues: true, display: 'checkboxes' })).toBeNull();
    expect(parameterDefinitionError({ id: 'd', name: 'Type', type: 'dropdown', allowMultipleValues: false, display: 'checkboxes' })).toBe(
      'Parameter “Type”: “checkboxes” needs a dropdown that allows multiple values.'
    );
    expect(parameterDefinitionError({ id: 'd', name: 'Type', type: 'string', allowMultipleValues: true, display: 'checkboxes' })).toBe(
      'Parameter “Type”: “checkboxes” needs a dropdown that allows multiple values.'
    );
  });
  it('refuses an unknown display', () => {
    expect(parameterDefinitionError({ id: 'd', name: 'Type', type: 'dropdown', allowMultipleValues: true, display: 'radio' })).toBe('Parameter “Type”: unknown display “radio”.');
  });
  it('falls back to the id when the parameter has no name', () => {
    expect(parameterDefinitionError({ id: 'n', type: 'string', validation: '>0' })).toBe('Parameter “n”: only Number parameters can have a validation.');
  });
});
