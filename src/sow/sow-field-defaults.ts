import { SowFieldKind } from './sow-version.model';

/**
 * The SOW document catalogue: one entry per section, in document order.
 *
 * This is the single source of truth for the SOW's language. It replaces two
 * copies that had already drifted apart — the prose hardcoded in
 * damplab-ui/src/components/SOWDocument.tsx (which the PDF rendered) and the
 * near-duplicate built by sowGenerator.ts::getStandardTerms() into sow.terms
 * (which nothing rendered). The text below is taken verbatim from the PDF, the
 * copy customers have actually been signing.
 */

export interface SowFieldDefinition {
  key: string;
  label: string;
  kind: SowFieldKind;
  /** Ascending; spaced by 10 so sections can be inserted without renumbering. */
  order: number;
  /**
   * False where the text carries figures another system bills from. Fee Schedule
   * is generated from the billing core that invoices read, so free-text editing
   * there would let the document quietly disagree with the invoice. Staff change
   * those numbers through the adjustments and per-service cost controls instead.
   */
  allowsTextOverride: boolean;
  enabledByDefault: boolean;
  /**
   * False on fields the document cannot be sent without. Blocks "Send to
   * customer" while the generated text is empty, and — since an empty required
   * field would otherwise sit hidden with no way for staff to notice it needs
   * attention — lets the field re-enable itself once its content arrives (see
   * normalizeIncomingFields / mergeCalculatedFields), rather than staying hidden
   * forever after the first empty save.
   */
  allowsEmpty: boolean;
}

export const SOW_PROSE_DEFAULTS: Record<string, string> = {
  statementOfWork: [
    'This Statement of Work (SOW) contains price and time information as per the discussions between the DAMP Lab at Boston University (hereinafter, "DAMP") and the potential client, to be officially reviewed and assigned by both parties. It contains the description of the services to be performed by DAMP, with relevant costs and terms, including scope of work, deliverables, and responsibilities of DAMP.',
    '',
    'This SOW is entered into by and between DAMP and the Client and is subject to the terms and conditions specified below. The Exhibit(s) to this SOW, if any, shall be deemed to be a part hereof. In the event of any inconsistency between the terms of the body of this SOW and the terms of the Exhibit(s) hereto, the terms of the body of this SOW shall prevail.'
  ].join('\n'),

  universityResponsibilities:
    'It is the responsibility of the University to provide regular and detailed updates about the Project and Project development, and to ensure that services are delivered on time with high-quality results and that the agreed number of service hours dedicated by the DAMP Lab team for the Project are rendered.',

  clientResponsibilities: 'The client is responsible for delivering all necessary materials and samples to the DAMP Lab for processing as well as all data analysis unless otherwise specified.',

  billToAddress: '610 Commonwealth Avenue, 4th Floor, Room 421, Boston – MA – 02215.',

  invoiceProcedures: [
    'Client will be invoiced for the Operations. It is agreed by the parties that standard invoicing is acceptable. Payments are due upon receipt of such invoices.',
    '',
    'Invoices shall be submitted in arrears, referencing this SOW Number to the address indicated above. Terms of payment for the invoice are due upon receipt by Client of a proper invoice. DAMP Lab shall provide Client with sufficient details to support its invoices, including list of services performed and justifications for authorized expenses, unless otherwise agreed to by the parties.'
  ].join('\n'),

  completionCriteria: [
    'DAMP Lab shall have fulfilled its obligations when any one of the following first occurs:',
    '- DAMP Lab completes the Operations described within this SOW, and Client accepts such Operations without unreasonable objections. No response from Client within 2-business days of deliverables being delivered by DAMP Lab is deemed acceptance.',
    '- DAMP Lab and/or Client has the right to cancel the Operations not yet provided with 20 business days advance written notice to the other party.'
  ].join('\n'),

  projectChangeControl: [
    'The following process will be followed if a change to this SOW is required:',
    '- A Project Change Request (PCR) will be the vehicle for communicating change. The PCR must describe the change, the rationale for the change, and the effect the change will have on the Project.',
    '- The designated Project Manager of the requesting party (University or Client) will review the proposed change and determine whether to submit a request to the other party.',
    '- Both Project Managers will review the proposed change and approve it for further consideration or reject it. The parties shall determine the effect that the implementation of the PCR will have on SOW price, schedule and other terms and conditions of the Agreement.'
  ].join('\n'),

  signatures: 'IN WITNESS WHEREOF, the parties hereto have caused this SOW to be effective as of the day, month and year first written above.',

  additionalInformation: '',
  clientProjectManager: '',
  clientCostCenter: ''
};

const { CALCULATED, PROSE } = SowFieldKind;

export const SOW_FIELD_CATALOG: SowFieldDefinition[] = [
  { key: 'sowTitle', label: 'Title', kind: CALCULATED, order: 10, allowsTextOverride: true, enabledByDefault: true, allowsEmpty: true },
  { key: 'parties', label: 'Parties', kind: CALCULATED, order: 20, allowsTextOverride: true, enabledByDefault: true, allowsEmpty: true },
  { key: 'statementOfWork', label: 'Statement of Work', kind: PROSE, order: 30, allowsTextOverride: true, enabledByDefault: true, allowsEmpty: true },
  { key: 'periodOfPerformance', label: 'Period of Performance', kind: CALCULATED, order: 40, allowsTextOverride: true, enabledByDefault: true, allowsEmpty: true },
  // Requires a Project Manager and Project Lead to say anything; staff must set
  // both before the document can be sent (see sendToCustomer's validation).
  { key: 'engagementResources', label: 'Engagement Resources', kind: CALCULATED, order: 50, allowsTextOverride: true, enabledByDefault: true, allowsEmpty: false },
  { key: 'scopeOfWork', label: 'Scope of Work', kind: CALCULATED, order: 60, allowsTextOverride: true, enabledByDefault: true, allowsEmpty: true },
  { key: 'deliverables', label: 'Deliverables', kind: CALCULATED, order: 70, allowsTextOverride: true, enabledByDefault: true, allowsEmpty: true },
  { key: 'universityResponsibilities', label: 'University Responsibilities', kind: PROSE, order: 80, allowsTextOverride: true, enabledByDefault: true, allowsEmpty: true },
  { key: 'clientResponsibilities', label: 'Client Responsibilities', kind: PROSE, order: 90, allowsTextOverride: true, enabledByDefault: true, allowsEmpty: true },
  // The only field with no pencil: its figures are what invoices bill from.
  { key: 'feeSchedule', label: 'Fee Schedule', kind: CALCULATED, order: 100, allowsTextOverride: false, enabledByDefault: true, allowsEmpty: true },
  { key: 'billToAddress', label: 'Bill To Address', kind: PROSE, order: 110, allowsTextOverride: true, enabledByDefault: true, allowsEmpty: true },
  { key: 'invoiceProcedures', label: 'Invoice Procedures', kind: PROSE, order: 120, allowsTextOverride: true, enabledByDefault: true, allowsEmpty: true },
  { key: 'completionCriteria', label: 'Completion Criteria', kind: PROSE, order: 130, allowsTextOverride: true, enabledByDefault: true, allowsEmpty: true },
  { key: 'projectChangeControl', label: 'Project Change Control Procedure', kind: PROSE, order: 140, allowsTextOverride: true, enabledByDefault: true, allowsEmpty: true },
  { key: 'additionalInformation', label: 'Additional Information', kind: PROSE, order: 150, allowsTextOverride: true, enabledByDefault: false, allowsEmpty: true },
  // Previously an overload in sowGenerator.ts that silently rewrote clientName /
  // clientInstitution. Now ordinary sections, off unless staff fill them in.
  { key: 'clientProjectManager', label: 'Client Project Manager', kind: PROSE, order: 160, allowsTextOverride: true, enabledByDefault: false, allowsEmpty: true },
  { key: 'clientCostCenter', label: 'Client Cost Center', kind: PROSE, order: 170, allowsTextOverride: true, enabledByDefault: false, allowsEmpty: true },
  { key: 'signatures', label: 'Signatures', kind: PROSE, order: 180, allowsTextOverride: true, enabledByDefault: true, allowsEmpty: true }
];

/** Custom fields sort after everything in the catalog. */
export const CUSTOM_FIELD_ORDER_BASE = 1000;

export const CUSTOM_FIELD_KEY_PREFIX = 'custom-';

export function isCustomFieldKey(key: string): boolean {
  return key.startsWith(CUSTOM_FIELD_KEY_PREFIX);
}

export function findFieldDefinition(key: string): SowFieldDefinition | undefined {
  return SOW_FIELD_CATALOG.find((d) => d.key === key);
}

export const CUSTOMER_CATEGORY_LABELS: Record<string, string> = {
  INTERNAL_CUSTOMERS: 'Internal customers',
  EXTERNAL_CUSTOMER_ACADEMIC: 'External (Academic)',
  EXTERNAL_CUSTOMER_MARKET: 'External (Market)',
  EXTERNAL_CUSTOMER_NO_SALARY: 'External (No salary)'
};

export function customerCategoryLabel(category?: string | null): string {
  return (category && CUSTOMER_CATEGORY_LABELS[category]) || 'Customer category';
}
