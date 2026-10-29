# Biosecurity screening: setup

What a server needs before the job page's Biosecurity card can screen anything. Screening runs from
staff's **Rerun screening** button (automatic screening on submission is paused:
`AUTO_SCREENING_ENABLED = false` in `src/job/job-screening.service.ts`).

## What gets screened

Nothing until a catalog editor flags it. In the Catalog Editor's parameter editor, tick
**Requires screening** on a Text parameter (its value is a sequence) or a Table parameter (then
pick its **Screening columns**: every cell in those columns of the uploaded file is screened). The
workbook's Parameter List sheet has `screening` (Y/N) and `screeningFields` (`; ` list) columns.
Values that do not look like DNA are skipped and counted on the run.

## Environment variables (backend `.env`)

| Variable | Required | Default | What it does |
|---|---|---|---|
| `ACLID_API_KEY` | For Aclid and KYC | unset | Aclid API key, sent raw in `Authorization`. Unset: Aclid is skipped (not failed), homology runs on SecureDNA only, and no KYC link can be minted. Read in `src/aclid/aclid.service.ts`. |
| `ACLID_API_URL` | No | `https://api.aclid.bio` | Aclid's origin; trailing slashes are trimmed. |
| `BIOSECURITY_HOMOLOGY_MODE` | No | `aclid` when `ACLID_API_KEY` is set, else `securedna` | `aclid`: SecureDNA runs only when Aclid gives no verdict. `securedna`: the Homology row is SecureDNA's alone, but an Aclid screen is still created for KYC when keyed. `both`: both always run and Homology fails if either denies. Anything else reads as the default; unkeyed, the mode is always `securedna`. Read in `src/job/job-screening.service.ts` via `parseHomologyMode` in `src/aclid/aclid-status.util.ts`. |
| `SECUREDNA_API_URL` | For SecureDNA | unset | Origin of a SecureDNA synthclient (the backend appends `/v1/screen`), e.g. `http://127.0.0.1:8787`. Unset: a SecureDNA leg records Unavailable. Read in `src/securedna/securedna.service.ts`. |
| `SECUREDNA_REQUEST_TIMEOUT_MS` | No | `120000` | Per-request timeout for the synthclient, in ms. A non-number or <= 0 uses the default. |

Screening a **Table** reads the customer's uploaded file from S3, so it also needs the
parameter-file bucket that uploads use: `AWS_REGION`, `WORKFLOW_PARAMETER_FILES_BUCKET` (falls back
to `JOB_ATTACHMENTS_BUCKET`), and `AWS_S3_ENDPOINT` for MinIO/local S3. Without a bucket the file
cannot be read and the run's detail says so; text parameters still screen. Locally, `/dev-run` starts
MinIO for the run (see `CANVAS/docs/architecture/local-dev-s3.md`).

## SecureDNA synthclient

SecureDNA screens through a **synthclient** container you run next to the backend, from SecureDNA's
image `ghcr.io/securedna/synthclient`, published on a local port that `SECUREDNA_API_URL` points at
(the example in `.env.example` maps it to 8787). The synthclient authenticates to SecureDNA with
the lab's synthesis token, which lives in `damplab-backend/secure_dna/certs/` (`token.st`,
`token.priv`, `token.passphrase`). That directory is gitignored: get the files from a colleague who
has them, never commit them, and mount them into the container as SecureDNA's synthclient
documentation describes.

## Keycloak: `showBiosecurity`

Who sees the Biosecurity card, the screening history and the batch details is a per-account
Keycloak user attribute, `showBiosecurity`. Absent means shown; the value `false` hides the card
and makes the backend refuse `jobScreeningRuns`, `screeningRun`, `screeningBatch`,
`screeningBatches` and `rerunJobHomologyScreening` with FORBIDDEN. Set it in Keycloak's admin
console (Users -> the user -> Attributes) or from Customer Management.

## Permission: `jobs:view-all`

Every biosecurity read and the rerun also require `jobs:view-all` (Administrator and Technician
tiers; see `docs/access-matrix.md`). Customers never see screening results; on their own job page
they see only the verification button Aclid's KYC needs.

## Verify it works

1. With `ACLID_API_URL` and `ACLID_API_KEY` both in `.env` (the script, unlike the backend, has no
   default URL), from `damplab-backend/`:
   `npx ts-node --transpile-only aclid-screen.ts` - it screens a benign default sequence and prints
   Aclid's verdict. A 401/403 means the key is wrong; a connection error means the URL is.
2. For SecureDNA: start the synthclient and `curl -s -X POST "$SECUREDNA_API_URL/v1/screen"` should
   answer (not refuse the connection).
3. In the app: flag a Text parameter, put a sequence of 30+ bp on a job, open the job as staff and
   press **Rerun screening**. The card's history dropdown gains a run; open it to see each
   sequence, Aclid's findings and materials, and SecureDNA's hits.
