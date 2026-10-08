import { BadRequestException } from '@nestjs/common';
import { checkValue, effectiveValidation, parseValidation } from '../services/parameter-validation';
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
