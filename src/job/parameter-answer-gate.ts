import { BadRequestException } from '@nestjs/common';
import { checkValue, effectiveValidation, parseValidation } from '../services/parameter-validation';
import { isEmptyParamValue, paramValuesSemanticallyEqual } from '../job-version/param-values.util';
import { otherTextEntryId, selectsOther } from '../workflow/utils/other-option.util';

/**
 * The server-side twin of the client form's inline errors: a submitted number
 * must obey its parameter's validation, and "Other" needs its text.
 *
 * Runs in `createJob`, beside `assertMaySubmitHiddenServices`, over the
 * already-piped workflows (each node carries its populated service). It applies
 * to every caller. Staff edits of a submitted job (`addWorkflowToJob`, a staff
 * save, a version restore) are not checked: jobs already submitted are never
 * re-validated.
 *
 * `services` is only for a caller whose nodes carry a service id instead of the
 * populated service.
 */
type NodeLike = { service?: unknown; serviceId?: unknown; formData?: unknown };
type WorkflowLike = { nodes?: ReadonlyArray<NodeLike> };
type ServiceLike = { _id?: unknown; id?: unknown; name?: unknown; parameters?: unknown };

/** Read as saved: an array of { id, value }, or an object keyed by id. Never collapses a multi-value answer. */
function valuesById(formData: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (Array.isArray(formData)) {
    for (const entry of formData) {
      if (entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string') out.set((entry as { id: string }).id, (entry as { value?: unknown }).value);
    }
  } else if (formData && typeof formData === 'object') {
    for (const [id, value] of Object.entries(formData)) out.set(id, value);
  }
  return out;
}

function populated(service: unknown): ServiceLike | undefined {
  return service && typeof service === 'object' && 'parameters' in service ? (service as ServiceLike) : undefined;
}

export function parameterAnswerProblems(workflows: ReadonlyArray<WorkflowLike> | undefined, services: ReadonlyArray<ServiceLike> = []): string[] {
  const byId = new Map(services.map((s) => [String(s._id ?? s.id), s] as const));
  const problems: string[] = [];
  for (const workflow of workflows ?? []) {
    for (const node of workflow.nodes ?? []) {
      const service = populated(node.service) ?? byId.get(String(node.serviceId ?? node.service));
      if (!service || !Array.isArray(service.parameters)) continue;
      const operation = typeof service.name === 'string' && service.name.trim() !== '' ? service.name : 'This operation';
      const values = valuesById(node.formData);
      for (const param of service.parameters as Array<Record<string, unknown>>) {
        if (!param || typeof param !== 'object' || typeof param.id !== 'string') continue;
        const label = typeof param.name === 'string' && param.name.trim() !== '' ? param.name : param.id;
        const value = values.get(param.id);

        if (param.type === 'number') {
          const parsed = parseValidation(effectiveValidation(param));
          if ('rules' in parsed && parsed.rules.length > 0) {
            for (const one of Array.isArray(value) ? value : [value]) {
              const message = checkValue(parsed.rules, one);
              if (message) {
                problems.push(`“${label}” on “${operation}”: ${message}`);
                break;
              }
            }
          }
        }

        if (selectsOther(param, value)) {
          const text = values.get(otherTextEntryId(param.id));
          if (typeof text !== 'string' || text.trim() === '') problems.push(`“${label}” on “${operation}”: Please specify “Other”.`);
        }
      }
    }
  }
  return problems;
}

export function assertParameterAnswersValid(workflows: ReadonlyArray<WorkflowLike> | undefined, services?: ReadonlyArray<ServiceLike>): void {
  const problems = parameterAnswerProblems(workflows, services);
  if (problems.length > 0) throw new BadRequestException(problems[0]);
}

/**
 * Rule 26 on a customer's resubmission, which never reaches `createJob`: it
 * saves through `saveJobWorkflows` and hands the job back with
 * `respondToJobReview`.
 *
 * Only the answers that save changes are checked. An answer stored before the
 * save and left as it was is never re-validated, so a job submitted before a
 * rule existed stays saveable. A node with nothing stored (`before` undefined:
 * a node the save adds, or one whose operation it swapped) has every answer
 * checked, exactly as `createJob` would.
 */
export type ChangedAnswersNode = { service: ServiceLike; before: unknown; after: unknown };

/**
 * Ids whose value differs between what is stored and what is being saved.
 * Semantic, like `parametersDiffer` in the version service: `5` and `"5"` are
 * the same answer, and an id that is empty on the side where it is missing is
 * not a change (the editor resubmits the whole current parameter list).
 */
export function changedAnswerIds(before: unknown, after: unknown): Set<string> {
  const was = valuesById(before);
  const now = valuesById(after);
  const changed = new Set<string>();
  for (const [id, value] of now) {
    if (!paramValuesSemanticallyEqual(was.get(id), value)) changed.add(id);
  }
  for (const [id, value] of was) {
    if (!now.has(id) && !isEmptyParamValue(value)) changed.add(id);
  }
  return changed;
}

export function changedAnswerProblems(nodes: ReadonlyArray<ChangedAnswersNode>): string[] {
  const problems: string[] = [];
  for (const node of nodes) {
    if (!Array.isArray(node.service?.parameters)) continue;
    const changed = changedAnswerIds(node.before, node.after);
    if (changed.size === 0) continue;
    // A parameter counts as changed when its own value moved or its "Other"
    // text did: blanking the text while "Other" stays selected is a change.
    const parameters = (node.service.parameters as Array<Record<string, unknown>>).filter(
      (param) => param && typeof param === 'object' && typeof param.id === 'string' && (changed.has(param.id) || changed.has(otherTextEntryId(param.id)))
    );
    // The whole of `after` goes in, so "Other" still finds its text entry.
    problems.push(...parameterAnswerProblems([{ nodes: [{ service: { name: node.service.name, parameters }, formData: node.after }] }]));
  }
  return problems;
}

export function assertChangedAnswersValid(nodes: ReadonlyArray<ChangedAnswersNode>): void {
  const problems = changedAnswerProblems(nodes);
  if (problems.length > 0) throw new BadRequestException(problems[0]);
}
