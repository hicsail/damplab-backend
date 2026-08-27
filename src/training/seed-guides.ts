import { CreateGuideInput } from './dto/guide.input';

/**
 * The two guides that used to be hardcoded JSX (`TrainingCanvas.tsx` and
 * `TrainingAdminEdit.tsx`), ported to markdown so nothing is lost when those pages
 * are replaced by the data-driven Learning Hub.
 *
 * **`TrainingAdminEdit` was a guide *about* admin editing, not an editor.** Its name
 * invites the confusion; it is content, and this is where it went. The actual editor
 * is the new `/training/admin` screen.
 *
 * Seeded insert-if-absent on slug (see `TrainingModule.onModuleInit`), so these are
 * a starting point staff can edit and never a thing that overwrites their edits.
 */
export const SEED_GUIDES: CreateGuideInput[] = [
  {
    title: 'Designing jobs on the canvas',
    slug: 'designing-jobs-on-the-canvas',
    category: 'For customers',
    order: 10,
    isPublished: true,
    body: `A walkthrough of building a workflow on the canvas and submitting it to the lab.

## The three panels

**Left sidebar — services and bundles.** Categories of services, plus any bundles DAMPLab staff have defined. You drag these onto the canvas.

**Centre — the workflow canvas.** Where you place and connect services. Each node is one service step.

**Right panel — details and parameters.** Select a node and its parameters appear here, along with any additional instructions you want to pass to the lab.

## Building a workflow

**Drag a single service.** Click and drag from the left sidebar onto the canvas. A node appears where you drop it.

**Drop a bundle.** Dragging a bundle creates several pre-connected nodes representing a common workflow. You can still edit or delete the individual nodes afterwards.

**Draw connections.** Use the handles on a node to draw an arrow to the next service. This defines the order your samples move through the workflow.

**Allowed connections.** Each service specifies which downstream services it may connect to, and the canvas uses those rules to help prevent workflows the lab cannot run.

## Filling in parameters

**Open node details.** Click a node to see its parameters in the right panel. Required fields are marked.

**Parameter types.** Text, numbers, dropdowns, or multi-value lists. Some services price per parameter, so these values can affect the estimate.

**Multi-value parameters.** Where a parameter allows several values you can add and remove entries — listing multiple samples, for example — directly in the node's parameter table.

## Submitting

**Save your canvas.** The Save button in the header stores the current canvas so you can load it again later.

**Go to Checkout.** The cart icon or the Checkout button shows a per-service cost breakdown and a total estimate.

**Final Checkout.** Add a job name, check your contact details, add any notes, and optionally attach supporting documents before submitting.

## After you submit

**Track job status.** Open Jobs, or the tracking link, to see the job state, its workflows, and any associated Statement of Work.

**Use comments for follow-ups.** Post questions or clarifications and attach further documents — protocols, data files — that the lab can see while processing your job.`
  },
  {
    title: 'Creating services, categories and bundles',
    slug: 'creating-services-categories-and-bundles',
    category: 'For staff',
    order: 10,
    isPublished: true,
    body: `How DAMPLab staff configure what appears on the workflow canvas: services, how they connect, and reusable bundles.

## 1. Getting to the editor

Open **Catalog & Inventory Editor** from the home page. It has tabs for Services (the individual building blocks), Categories (groups for the canvas sidebar), Bundles (pre-built workflows) and Inventory.

## 2. Configuring services

Services are the atomic steps that can be dragged onto the canvas.

**Name and description.** Use a concise, user-friendly name. The description should explain what the service does and any important assumptions — sample type, whether QC is included.

**Pricing mode.** Use *Service price* when the cost is fixed per service, and *Parameter-based* when specific parameters — number of samples, sequence length — should drive the price.

**Parameters.** Configure the fields a user fills in on the canvas. Parameters can be required, multi-value, and individually priced for parameter-based pricing.

**Allowed connections.** Specify which downstream services this one may connect to. The canvas validates against this list, which is what stops invalid workflows being submitted.

**Deliverables.** Optionally list what the lab returns — "FASTQ files", "QC report" — so a Statement of Work can state it clearly.

## 3. Parameters and pricing in detail

**Core fields.** Each parameter has a name, a type (text, number, dropdown…), a description and a required flag. These drive the inputs shown when a node is selected.

**Multi-value parameters.** Allow multiple values where users will list several items. On the canvas they can add and remove rows.

**Parameter-level pricing.** For services with parameter-based pricing, individual parameters carry a price, multiplied by the number of values to estimate the node's cost.

**Explain the price.** Where a pricing explanation field is available, describe how the figure is arrived at, so a customer understands why a service costs more as they add parameters.

## 4. Organising categories

**Use clear labels.** "Sequencing", "Cloning", "QC & Analytics". Avoid internal jargon so external customers can navigate.

**Assign services.** Each category can hold several services, and they appear grouped under it in the canvas sidebar.

## 5. Creating bundles

**Name the workflow, not the steps.** "Whole-genome sequencing prep", "Cloning and small-scale expression".

**Pick services in execution order.** Dropped on the canvas, a bundle appears as a connected chain in the order you chose.`
  }
];
