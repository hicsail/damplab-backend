import { readyOperationIds } from './operation-readiness';
import { WorkflowNodeState } from '../models/node.model';

/**
 * Which operations a bench user can actually start.
 *
 * Computed server-side, over the whole workflow: a blocking predecessor is
 * frequently assigned to somebody else, so the set of nodes on a technician's
 * bench is not enough to answer this. It is also why the answer cannot be
 * derived in the browser from `assignedOperations` alone.
 */

const QUEUED = WorkflowNodeState.QUEUED;
const DONE = WorkflowNodeState.COMPLETE;

/** a → b → c */
const chain = {
  nodes: [
    { id: 'a', state: QUEUED },
    { id: 'b', state: QUEUED },
    { id: 'c', state: QUEUED }
  ],
  edges: [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' }
  ]
};

describe('readyOperationIds', () => {
  it('treats a node with no predecessors as ready', () => {
    expect(readyOperationIds(chain)).toEqual(new Set(['a']));
  });

  it('opens the next node once its predecessor completes', () => {
    const nodes = [
      { id: 'a', state: DONE },
      { id: 'b', state: QUEUED },
      { id: 'c', state: QUEUED }
    ];

    // 'a' stays in the set: readiness is about not being blocked, and the caller
    // filters completed work out separately.
    expect(readyOperationIds({ ...chain, nodes })).toEqual(new Set(['a', 'b']));
  });

  it('keeps a node blocked while any predecessor is incomplete', () => {
    const nodes = [
      { id: 'a', state: QUEUED },
      { id: 'b', state: DONE },
      { id: 'c', state: QUEUED }
    ];

    // b being done does not unblock c, because a is still holding the chain up.
    expect(readyOperationIds({ ...chain, nodes })).toEqual(new Set(['a']));
  });

  it('requires every branch of a join, not just one', () => {
    const nodes = [
      { id: 'a', state: DONE },
      { id: 'b', state: QUEUED },
      { id: 'join', state: QUEUED }
    ];
    const edges = [
      { source: 'a', target: 'join' },
      { source: 'b', target: 'join' }
    ];

    expect(readyOperationIds({ nodes, edges })).toEqual(new Set(['a', 'b']));
  });

  it('treats every node of an edgeless workflow as ready', () => {
    const nodes = [
      { id: 'x', state: QUEUED },
      { id: 'y', state: QUEUED }
    ];

    expect(readyOperationIds({ nodes, edges: [] })).toEqual(new Set(['x', 'y']));
  });

  it('falls back to showing everything when the graph has a cycle', () => {
    // A cycle should never reach us, but hiding an entire workflow because its
    // edges are malformed would leave a technician staring at an empty bench
    // with no way to work out why.
    const nodes = [
      { id: 'a', state: QUEUED },
      { id: 'b', state: QUEUED }
    ];
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' }
    ];

    expect(readyOperationIds({ nodes, edges })).toEqual(new Set(['a', 'b']));
  });

  it('ignores edges pointing outside the workflow', () => {
    const nodes = [{ id: 'a', state: QUEUED }];
    const edges = [{ source: 'ghost', target: 'a' }];

    // A dangling reference must not permanently block real work.
    expect(readyOperationIds({ nodes, edges })).toEqual(new Set(['a']));
  });
});
