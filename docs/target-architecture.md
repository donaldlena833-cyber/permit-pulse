# Target Architecture

## Product Statement

PermitPulse is an operator-first lead intelligence and outreach operating system for specialty contractors.

Current mode:

- single-company optimized for MetroGlass Pro

Next mode:

- workspace-ready architecture without pretending to be a mature SaaS platform

Long-term option:

- multi-workspace commercial product or managed-service platform

## Design Principles

1. Preserve MetroGlass daily usability.
2. Keep one canonical product spine.
3. Prefer explicit modules over generic frameworks.
4. Make every important decision inspectable.
5. Keep outbound safety conservative by default.
6. Put workspace boundaries in architecture, not in marketing.

## Canonical Layers

### 1. Source Ingestion

Purpose:

- pull source signals into the system

Sources today:

- NYC permit data
- imported CSV prospect lists

Responsibilities:

- normalize timestamps, addresses, source metadata
- preserve source provenance
- create the initial lead or prospect record

### 2. Lead Normalization

Purpose:

- convert raw source records into a consistent operating model

Responsibilities:

- dedupe
- build stable keys
- normalize location and description fields
- classify source type and initial queue state

### 3. Company Resolution

Purpose:

- decide which company is most likely connected to the lead

Responsibilities:

- generate and score candidate companies
- keep chosen and rejected candidates inspectable
- preserve reasons for the selected company

### 4. Contact Discovery

Purpose:

- gather reachable contact options for the resolved company or imported lead

Responsibilities:

- collect public emails
- store provenance
- preserve phones and website evidence
- support manual operator additions

### 5. Contact Trust Scoring

Purpose:

- separate strong contact evidence from weak guesses

Responsibilities:

- trust scoring
- sendability checks
- fallback route handling
- explicit reasoning arrays

### 6. Routing and Readiness

Purpose:

- determine the next action and whether the record is send-ready

Responsibilities:

- ready vs review vs email_required
- manual override paths
- fallback switching
- operator approval state
- do-not-contact and opt-out handling

### 7. Draft Generation

Purpose:

- prepare practical outreach copy tied to the chosen route and workspace identity

Responsibilities:

- route-aware drafts
- workspace sender profile
- attachment awareness
- editable drafts with preserved operator changes

### 8. Sending

Purpose:

- send only when workspace configuration, route quality, and safeguards allow it

Responsibilities:

- manual versus automation send paths
- send caps
- mailbox usage
- duplicate prevention
- workspace-aware sender identity

### 9. Follow-Ups

Purpose:

- schedule and execute the next touch safely

Responsibilities:

- follow-up queue creation
- skip and cancel paths
- reply and opt-out cancellation
- operator phone follow-up logging

### 10. Outcome Tracking

Purpose:

- capture what happened after outreach

Responsibilities:

- sent
- delivered
- replied
- bounced
- opted_out
- won
- lost

### 11. Settings and Workspace Configuration

Purpose:

- keep system behavior configurable in one place

Responsibilities:

- send caps
- trust thresholds
- follow-up sequence
- active sources
- attachment library
- sender profile
- workspace mailbox status

### 12. Operator UI

Purpose:

- expose the entire product spine as an inspectable daily console

Surfaces:

- Today
- Leads
- Lead Detail
- Outreach
- Settings

Operator UI rules:

- show why a record is in its current state
- keep the next action obvious
- surface exceptions instead of hiding them
- avoid decorative CRM clutter

## Core Entities

The target product should revolve around these entities:

- Workspace
- Lead
- Company
- Contact Candidate
- Outreach Draft
- Outreach Event
- Follow-Up
- Outcome
- Suppression
- Audit Event
- Automation Run
- App Config

## Product Spine

The canonical lifecycle is:

1. source signal
2. ingested record
3. normalized lead
4. resolved company
5. discovered contacts
6. scored contact candidates
7. selected route
8. generated draft
9. send status
10. follow-up schedule
11. outcome
12. history and learning

Every major module in the repo should map cleanly onto this spine.

## Workspace Boundary

Workspace-ready does not mean full SaaS now.

It means:

- records belong to a workspace
- config is workspace-scoped
- attachments are workspace-scoped
- mailbox state is workspace-scoped
- audit history is workspace-scoped
- UI reads and writes through a workspace context

It does not mean:

- public signup funnel optimization
- multi-tenant billing growth work
- generalized customer admin complexity
- broad RLS design work beyond current operational needs

## What Stays Intentionally Deferred

- public marketing site
- self-serve billing as a primary workflow
- polished self-serve mailbox provisioning
- heavy CRM abstractions that do not improve daily operator work
- broad marketplace/generalized sales-platform features
