import { checkValue, effectiveValidation, parameterDefinitionError, parseValidation, ruleMessage, screeningRuleViolation, ValidationRule } from './parameter-validation';

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

  it('F11: a whitespace-only answer is an empty answer, not the number 0', () => {
    for (const blank of [' ', '   ', '\t', '\n', ' \r\n ']) {
      expect(checkValue(rules('<5'), blank)).toBeNull();
      expect(checkValue(rules('>0'), blank)).toBeNull();
      expect(checkValue(rules('>=1 && <=3'), blank)).toBeNull();
    }
    // An answer with text in it is still checked, padded or not.
    expect(checkValue(rules('>0'), ' 0 ')).toBe('Must be greater than 0');
    expect(checkValue(rules('<5'), ' 7 ')).toBe('Must be less than 5');
    expect(checkValue(rules('>0'), ' x ')).toBe('Must be a number');
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
  // An answer is stored under its parameter's id; a file parameter without one would never have its file uploaded.
  it.each(['file', 'table', 'sampleSheet'])('refuses a %s parameter with no id', (type) => {
    expect(parameterDefinitionError({ name: 'Plasmid map', type })).toBe('Parameter “Plasmid map”: a File Upload or Table parameter needs an id.');
    expect(parameterDefinitionError({ id: '  ', name: 'Plasmid map', type })).toBe('Parameter “Plasmid map”: a File Upload or Table parameter needs an id.');
    expect(parameterDefinitionError({ id: 'map', name: 'Plasmid map', type })).toBeNull();
  });

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
  it('accepts a matrix written as name;column, on anything but a Table', () => {
    expect(parameterDefinitionError({ id: 'd', name: 'AFP Dilution', type: 'dropdown', matrix: 'matrixA;2' })).toBeNull();
    expect(parameterDefinitionError({ id: 'd', name: 'AFP Dilution', type: 'dropdown', matrix: ' ' })).toBeNull();
    for (const bad of ['matrixA', 'matrixA;0', ';2', 'matrixA;x', 7]) {
      expect(parameterDefinitionError({ id: 'd', name: 'AFP Dilution', type: 'dropdown', matrix: bad })).toBe(
        'Parameter “AFP Dilution”: write the matrix as name;column, e.g. matrixA;2 (the column is 1 or more).'
      );
    }
    expect(parameterDefinitionError({ id: 'd', name: 'Plate', type: 'table', matrix: 'm;1' })).toBe('Parameter “Plate”: a Table cannot be placed in a matrix.');
  });

  it('accepts multiselect on a multi-value dropdown only', () => {
    expect(parameterDefinitionError({ id: 'd', name: 'Assays', type: 'dropdown', allowMultipleValues: true, display: 'multiselect' })).toBeNull();
    expect(parameterDefinitionError({ id: 'd', name: 'Assays', type: 'dropdown', allowMultipleValues: false, display: 'multiselect' })).toBe(
      'Parameter “Assays”: “multiselect” needs a dropdown that allows multiple values.'
    );
    expect(parameterDefinitionError({ id: 'd', name: 'Assays', type: 'dropdown', allowMultipleValues: true, display: 'slider' })).toBe('Parameter “Assays”: unknown display “slider”.');
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

describe('screening definition rules (biosecurity-update behaviour 4)', () => {
  const text = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ id: 'insert', name: 'Insert', type: 'string', ...over });
  const table = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'plate',
    name: 'Plate',
    type: 'table',
    tableData: { columns: [{ header: 'Well' }, { header: 'Insert' }] },
    ...over
  });

  it('accepts a flagged Text, a flagged Table with known columns, and anything unflagged', () => {
    expect(screeningRuleViolation(text({ screening: true }))).toBeNull();
    expect(screeningRuleViolation(table({ screening: true, screeningFields: [' insert '] }))).toBeNull();
    expect(screeningRuleViolation({ ...table({ screening: true, screeningFields: ['Insert'] }), type: 'sampleSheet' })).toBeNull();
    expect(screeningRuleViolation(text())).toBeNull();
    expect(screeningRuleViolation(text({ screening: false }))).toBeNull();
  });

  it('refuses the flag on any other type', () => {
    expect(screeningRuleViolation({ id: 'n', name: 'Cycles', type: 'number', screening: true })).toBe('Only Text and Table parameters can require screening.');
    expect(screeningRuleViolation({ id: 'f', name: 'Map', type: 'file', screening: true })).toBe('Only Text and Table parameters can require screening.');
    expect(screeningRuleViolation(text({ screening: 'yes' }))).toBe('“Requires screening” must be true or false.');
  });

  it('refuses screening columns on a non-table, and a non-list', () => {
    expect(screeningRuleViolation(text({ screening: true, screeningFields: ['Insert'] }))).toBe('Only a Table has screening columns.');
    expect(screeningRuleViolation(table({ screening: true, screeningFields: 'Insert' }))).toBe('Screening columns must be a list of column names.');
  });

  it('refuses a flagged Table with no screening columns', () => {
    expect(screeningRuleViolation(table({ screening: true }))).toBe('A Table that requires screening needs at least one screening column.');
    expect(screeningRuleViolation(table({ screening: true, screeningFields: [' '] }))).toBe('A Table that requires screening needs at least one screening column.');
  });

  it('refuses a screening column the Table does not have, case-insensitively', () => {
    expect(screeningRuleViolation(table({ screening: true, screeningFields: ['insert', 'Vector'] }))).toBe("Screening column “Vector” is not one of this Table's columns.");
  });

  it('leaves a template-only Table to the template check', () => {
    expect(screeningRuleViolation({ id: 't', name: 'T', type: 'table', templateFile: { key: 'sample-sheet-templates/a.xlsx' }, screening: true, screeningFields: ['Anything'] })).toBeNull();
  });

  it('parameterDefinitionError reports it with the parameter label', () => {
    expect(parameterDefinitionError({ id: 'n', name: 'Cycles', type: 'number', screening: true })).toBe('Parameter “Cycles”: Only Text and Table parameters can require screening.');
  });
});
