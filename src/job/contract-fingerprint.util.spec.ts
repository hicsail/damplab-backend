import { canonicalizeParamValue, contractFingerprint, ContractFingerprintInput, ContractFingerprintNodeInput, paramValuesSemanticallyEqual, projectContract } from './contract-fingerprint.util';
import { RUN_COUNT_PARAM_ID } from '../pricing/service-pricing.util';

const SERVICE_A = '000000000000000000000001';
const SERVICE_B = '000000000000000000000002';
const NODE_A = 'node-a';
const NODE_B = 'node-b';

type WorkflowInput = Parameters<typeof contractFingerprint>[0]['workflows'][number];

function baseInput(overrides: Partial<ContractFingerprintInput> = {}): ContractFingerprintInput {
  return {
    customerCategory: 'INTERNAL_CUSTOMERS',
    workflows: [
      {
        workflowId: 'wf-db-1',
        name: 'Workflow One',
        nodes: [
          {
            id: NODE_A,
            label: 'Service Alpha',
            serviceId: SERVICE_A,
            serviceName: 'Alpha Display',
            formData: [{ id: 'vol', value: 10 }],
            additionalInstructions: '  handle gently  ',
            price: 100.5,
            position: { x: 10, y: 20 }
          },
          {
            id: NODE_B,
            label: 'Service Beta',
            serviceId: SERVICE_B,
            serviceName: 'Beta Display',
            formData: [{ id: 'temp', value: 37 }],
            additionalInstructions: '',
            price: 50,
            position: { x: 30, y: 40 }
          }
        ],
        edges: [
          { id: 'edge-1', source: NODE_A, target: NODE_B },
          { id: 'edge-2', source: NODE_B, target: NODE_A }
        ]
      }
    ],
    ...overrides
  };
}

describe('contractFingerprint', () => {
  it('hashes identical semantic inputs equally despite reordered formData entries', () => {
    const a = baseInput();
    const b = baseInput({
      workflows: [
        {
          ...baseInput().workflows[0],
          nodes: [
            {
              ...baseInput().workflows[0].nodes[0],
              formData: [
                { id: '__unused', value: '' },
                { id: 'vol', value: 10 }
              ]
            },
            baseInput().workflows[0].nodes[1]
          ]
        }
      ]
    });
    expect(contractFingerprint(b)).toBe(contractFingerprint(a));
  });

  it('hashes identical semantic inputs equally despite nested object key order', () => {
    const nestedA = { alpha: 1, beta: { z: 3, y: 2 } };
    const nestedB = { beta: { y: 2, z: 3 }, alpha: 1 };
    const a = baseInput({
      workflows: [
        {
          ...baseInput().workflows[0],
          nodes: [{ ...baseInput().workflows[0].nodes[0], formData: [{ id: 'config', value: nestedA }] }, baseInput().workflows[0].nodes[1]]
        }
      ]
    });
    const b = baseInput({
      workflows: [
        {
          ...baseInput().workflows[0],
          nodes: [{ ...baseInput().workflows[0].nodes[0], formData: [{ id: 'config', value: nestedB }] }, baseInput().workflows[0].nodes[1]]
        }
      ]
    });
    expect(contractFingerprint(b)).toBe(contractFingerprint(a));
  });

  it('hashes identical topology equally when endpoint ids contain the edge delimiter', () => {
    const left = 'node->left';
    const right = 'node->right';
    const a = baseInput({
      workflows: [
        {
          workflowId: 'wf-db-1',
          name: 'Workflow One',
          nodes: [
            { id: left, serviceId: SERVICE_A, formData: [], price: 1 },
            { id: right, serviceId: SERVICE_B, formData: [], price: 2 }
          ],
          edges: [{ id: 'e1', source: left, target: right }]
        }
      ]
    });
    const b = baseInput({
      workflows: [
        {
          workflowId: 'wf-other',
          name: 'Other',
          nodes: [
            { id: left, serviceId: SERVICE_A, formData: [], price: 1 },
            { id: right, serviceId: SERVICE_B, formData: [], price: 2 }
          ],
          edges: [{ id: 'e2', source: left, target: right }]
        }
      ]
    });
    expect(contractFingerprint(b)).toBe(contractFingerprint(a));
    expect(projectContract(a).edges).toEqual([[left, right]]);
  });

  it('hashes identical semantic inputs equally despite edge ordering', () => {
    const a = baseInput();
    const b = baseInput({
      workflows: [
        {
          ...baseInput().workflows[0],
          edges: [
            { id: 'edge-z', source: NODE_B, target: NODE_A },
            { id: 'edge-a', source: NODE_A, target: NODE_B }
          ]
        }
      ]
    });
    expect(contractFingerprint(b)).toBe(contractFingerprint(a));
  });

  it('changes hash when a parameter value changes', () => {
    const base = baseInput();
    const changed = baseInput({
      workflows: [
        {
          ...base.workflows[0],
          nodes: [{ ...base.workflows[0].nodes[0], formData: [{ id: 'vol', value: 11 }] }, base.workflows[0].nodes[1]]
        }
      ]
    });
    expect(contractFingerprint(changed)).not.toBe(contractFingerprint(base));
  });

  it('changes hash when additional instructions change', () => {
    const base = baseInput();
    const changed = baseInput({
      workflows: [
        {
          ...base.workflows[0],
          nodes: [{ ...base.workflows[0].nodes[0], additionalInstructions: 'new note' }, base.workflows[0].nodes[1]]
        }
      ]
    });
    expect(contractFingerprint(changed)).not.toBe(contractFingerprint(base));
  });

  it('changes hash when edge topology changes', () => {
    const base = baseInput();
    const changed = baseInput({
      workflows: [
        {
          ...base.workflows[0],
          edges: [{ id: 'edge-1', source: NODE_A, target: NODE_B }]
        }
      ]
    });
    expect(contractFingerprint(changed)).not.toBe(contractFingerprint(base));
  });

  // Node order is client-controlled — saveJobWorkflows stores whatever order the
  // editor sent — so it cannot be allowed to move the fingerprint. Otherwise a
  // drag on the canvas reads as "the job changed after it was accepted".
  it('hashes identical semantic inputs equally despite node ordering', () => {
    const base = baseInput();
    const reordered = baseInput({
      workflows: [
        {
          ...base.workflows[0],
          nodes: [base.workflows[0].nodes[1], base.workflows[0].nodes[0]]
        }
      ]
    });
    expect(contractFingerprint(reordered)).toBe(contractFingerprint(base));
  });

  it('hashes identical semantic inputs equally despite workflow ordering', () => {
    const [nodeA, nodeB] = baseInput().workflows[0].nodes;
    const split = (nodes: ContractFingerprintNodeInput[][]): ContractFingerprintInput =>
      baseInput({
        workflows: nodes.map((group, index) => ({ workflowId: `wf-${index}`, name: `Workflow ${index}`, nodes: group, edges: [] })) as WorkflowInput[]
      });
    expect(contractFingerprint(split([[nodeB], [nodeA]]))).toBe(contractFingerprint(split([[nodeA], [nodeB]])));
  });

  it('changes hash when two nodes sharing an id differ in content', () => {
    const clash = (price: number): ContractFingerprintInput =>
      baseInput({
        workflows: [
          {
            workflowId: 'wf-db-1',
            name: 'Workflow One',
            nodes: [
              { id: 'dup', serviceId: SERVICE_A, formData: [], price: 100 },
              { id: 'dup', serviceId: SERVICE_A, formData: [], price }
            ],
            edges: []
          }
        ] as WorkflowInput[]
      });
    expect(contractFingerprint(clash(250))).not.toBe(contractFingerprint(clash(100)));
  });

  it('changes hash when stored price changes', () => {
    const base = baseInput();
    const changed = baseInput({
      workflows: [
        {
          ...base.workflows[0],
          nodes: [{ ...base.workflows[0].nodes[0], price: 101.5 }, base.workflows[0].nodes[1]]
        }
      ]
    });
    expect(contractFingerprint(changed)).not.toBe(contractFingerprint(base));
  });

  it('changes hash when customer category changes', () => {
    expect(contractFingerprint(baseInput({ customerCategory: 'EXTERNAL_CUSTOMER_MARKET' }))).not.toBe(contractFingerprint(baseInput({ customerCategory: 'INTERNAL_CUSTOMERS' })));
  });

  it('does not change hash for canvas position', () => {
    const base = baseInput();
    const moved = baseInput({
      workflows: [
        {
          ...base.workflows[0],
          nodes: [
            { ...base.workflows[0].nodes[0], position: { x: 999, y: 888 } },
            { ...base.workflows[0].nodes[1], position: { x: 1, y: 2 } }
          ]
        }
      ]
    });
    expect(contractFingerprint(moved)).toBe(contractFingerprint(base));
  });

  it('does not change hash for workflow id, name, or ordering metadata', () => {
    const base = baseInput();
    const relabeled = baseInput({
      workflows: [
        {
          workflowId: 'different-db-id',
          name: 'Renamed workflow',
          nodes: base.workflows[0].nodes.map((n: ContractFingerprintNodeInput) => ({
            ...n,
            label: `${n.label}-changed`,
            serviceName: `${n.serviceName}-changed`
          })),
          edges: base.workflows[0].edges!.map((e) => ({ ...e, id: `${e.id}-changed` }))
        }
      ]
    });
    expect(contractFingerprint(relabeled)).toBe(contractFingerprint(base));
  });

  it('does not change hash for empty catalogue parameters', () => {
    const base = baseInput();
    const withEmptyCatalogueParam = baseInput({
      workflows: [
        {
          ...base.workflows[0],
          nodes: [
            {
              ...base.workflows[0].nodes[0],
              formData: [
                { id: 'vol', value: 10 },
                { id: 'newSinceSubmission', value: '' },
                { id: 'alsoEmpty', value: null }
              ]
            },
            base.workflows[0].nodes[1]
          ]
        }
      ]
    });
    expect(contractFingerprint(withEmptyCatalogueParam)).toBe(contractFingerprint(base));
  });

  it('does not change hash for operational metadata on nodes', () => {
    const base = baseInput();
    const withOps = baseInput({
      workflows: [
        {
          ...base.workflows[0],
          nodes: base.workflows[0].nodes.map((n: ContractFingerprintNodeInput) => ({
            ...n,
            state: 'IN_PROGRESS',
            assigneeId: 'tech-1',
            usedInventory: [{ id: 'inv-1' }]
          }))
        }
      ]
    });
    expect(contractFingerprint(withOps)).toBe(contractFingerprint(base));
  });

  it('treats absent run count and explicit run count 1 equally', () => {
    const withoutRunCount = baseInput({
      workflows: [
        {
          ...baseInput().workflows[0],
          nodes: [{ ...baseInput().workflows[0].nodes[0], formData: [{ id: 'vol', value: 10 }] }, baseInput().workflows[0].nodes[1]]
        }
      ]
    });
    const withRunCountOne = baseInput({
      workflows: [
        {
          ...baseInput().workflows[0],
          nodes: [
            {
              ...baseInput().workflows[0].nodes[0],
              formData: [
                { id: 'vol', value: 10 },
                { id: RUN_COUNT_PARAM_ID, value: 1 }
              ]
            },
            baseInput().workflows[0].nodes[1]
          ]
        }
      ]
    });
    expect(contractFingerprint(withRunCountOne)).toBe(contractFingerprint(withoutRunCount));
  });

  it('changes hash when run count changes from the default', () => {
    const withoutRunCount = baseInput();
    const withRunCountFour = baseInput({
      workflows: [
        {
          ...baseInput().workflows[0],
          nodes: [
            {
              ...baseInput().workflows[0].nodes[0],
              formData: [
                { id: 'vol', value: 10 },
                { id: RUN_COUNT_PARAM_ID, value: 4 }
              ]
            },
            baseInput().workflows[0].nodes[1]
          ]
        }
      ]
    });
    expect(contractFingerprint(withRunCountFour)).not.toBe(contractFingerprint(withoutRunCount));
  });
});

describe('paramValuesSemanticallyEqual', () => {
  it('treats nested object key order as equal', () => {
    const a = { z: 1, nested: { b: 2, a: 3 } };
    const b = { nested: { a: 3, b: 2 }, z: 1 };
    expect(paramValuesSemanticallyEqual(a, b)).toBe(true);
    expect(canonicalizeParamValue(a)).toBe(canonicalizeParamValue(b));
  });

  it('treats number and numeric string as equal', () => {
    expect(paramValuesSemanticallyEqual(10, '10')).toBe(true);
  });

  it('detects nested object content changes', () => {
    expect(paramValuesSemanticallyEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('projectContract', () => {
  it('projects customer category, ordered nodes, normalized parameters, trimmed instructions, cents prices, and sorted edges', () => {
    const projection = projectContract(baseInput());
    expect(projection).toEqual({
      customerCategory: 'INTERNAL_CUSTOMERS',
      nodes: [
        {
          id: NODE_A,
          serviceId: SERVICE_A,
          parameters: { vol: '10' },
          additionalInstructions: 'handle gently',
          priceCents: 10050
        },
        {
          id: NODE_B,
          serviceId: SERVICE_B,
          parameters: { temp: '37' },
          additionalInstructions: '',
          priceCents: 5000
        }
      ],
      edges: [
        [NODE_A, NODE_B],
        [NODE_B, NODE_A]
      ]
    });
  });

  it('flattens multiple workflows into one node list sorted by id, whatever order they arrive in', () => {
    const workflows = (first: 0 | 1): WorkflowInput[] => {
      const nodes = baseInput().workflows[0].nodes;
      const ordered = first === 0 ? [nodes[0], nodes[1]] : [nodes[1], nodes[0]];
      return ordered.map((node, index) => ({ workflowId: `wf-${index}`, name: `Workflow ${index}`, nodes: [node], edges: [] })) as WorkflowInput[];
    };

    expect(projectContract(baseInput({ workflows: workflows(0) })).nodes.map((n: { id: string }) => n.id)).toEqual([NODE_A, NODE_B]);
    expect(projectContract(baseInput({ workflows: workflows(1) })).nodes.map((n: { id: string }) => n.id)).toEqual([NODE_A, NODE_B]);
  });

  it('sorts edges with explicit lexical ordering independent of input order', () => {
    // NFC é vs NFD e+combining-acute: distinct strings, but localeCompare returns 0.
    const nfcTarget = 'node-\u00E9';
    const nfdTarget = 'node-e\u0301';
    expect(nfcTarget).not.toBe(nfdTarget);
    expect(nfcTarget.localeCompare(nfdTarget)).toBe(0);

    const first = nfdTarget < nfcTarget ? nfdTarget : nfcTarget;
    const second = nfdTarget < nfcTarget ? nfcTarget : nfdTarget;

    const workflow = (edges: { source: string; target: string }[]): ContractFingerprintInput => ({
      customerCategory: 'INTERNAL_CUSTOMERS',
      workflows: [
        {
          nodes: [
            { id: 'a', serviceId: SERVICE_A, formData: [] },
            { id: nfcTarget, serviceId: SERVICE_A, formData: [] },
            { id: nfdTarget, serviceId: SERVICE_A, formData: [] }
          ],
          edges
        }
      ]
    });

    const forward = projectContract(
      workflow([
        { source: 'a', target: nfcTarget },
        { source: 'a', target: nfdTarget }
      ])
    ).edges;
    const reverse = projectContract(
      workflow([
        { source: 'a', target: nfdTarget },
        { source: 'a', target: nfcTarget }
      ])
    ).edges;

    expect(reverse).toEqual(forward);
    expect(forward).toEqual([
      ['a', first],
      ['a', second]
    ]);
  });
});
