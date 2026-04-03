# Outreach CRM Rebuild

## Goal

Turn the current `Prospects` area into a true outbound CRM inside `leads.metroglasspro.com` focused on opening conversations through automated email outreach with low manual overhead.

## Business Rules

- Goal: open conversations
- Priority order:
  1. architects
  2. interior designers
  3. property managers
  4. project managers
  5. general contractors
- One category per upload
- Unique key: normalized email
- Duplicate contacts in the same file should be removed automatically
- Description is for personalization, not general notes
- Every email includes:
  - MetroGlass PDF attachment
  - phone number
  - website
- Signature should be consistent and production-ready
- Sequence:
  1. initial email
  2. follow-up after 3 days
  3. follow-up after 14 days
- Stop outreach on:
  - reply
  - bounce
  - opt-out
  - manual do-not-contact
  - company/domain suppression
- Weekday sending only
- Default send policy:
  - 10 total sends per category per weekday at 11:00 AM America/New_York
  - follow-ups should consume the day quota before new initials

## Product Direction

The current Prospects feature is still shaped like a lead queue with import and send actions attached. The target system should behave like an outbound CRM with strong automation.

Core entities:

- Contacts
- Companies
- Categories
- Sequences
- Sequence steps
- Campaigns
- Imports
- Activities
- Suppressions

## Target Data Model

### Contacts

Primary record for each reachable recipient.

Suggested fields:

- `id`
- `email_address`
- `email_normalized`
- `contact_name`
- `contact_role`
- `company_name`
- `company_domain`
- `website`
- `phone`
- `category`
- `description`
- `personalization_summary`
- `status`
- `first_sent_at`
- `last_sent_at`
- `last_replied_at`
- `gmail_thread_id`
- `active_sequence_id`
- `created_at`
- `updated_at`

### Companies

Reusable company-level record for grouping and suppression.

Suggested fields:

- `id`
- `name`
- `domain`
- `website`
- `category`
- `suppressed`
- `suppressed_reason`
- `created_at`
- `updated_at`

### Campaigns

Operational grouping for outbound strategy and reporting. Campaigns should outlive a single import batch.

Suggested fields:

- `id`
- `name`
- `category`
- `status`
- `template_variant`
- `daily_cap`
- `send_time_local`
- `timezone`
- `created_at`
- `updated_at`

### Imports

Track upload history and row validation.

Suggested fields:

- `id`
- `filename`
- `category`
- `row_count`
- `imported_count`
- `skipped_count`
- `skipped_by_reason`
- `created_at`

### Sequence Steps

Drive the outbound cadence.

Suggested fields:

- `id`
- `contact_id`
- `step_number`
- `kind`
- `scheduled_at`
- `status`
- `draft_subject`
- `draft_body`
- `sent_at`
- `created_at`
- `updated_at`

### Suppressions

Central stop-list for safety.

Suggested fields:

- `id`
- `scope_type` (`email`, `domain`, `company`)
- `scope_value`
- `reason`
- `source`
- `created_at`

## UX Structure

### Overview

Command-center view showing:

- imported today
- queued today
- sent today
- delivered
- positive replies
- suppressions
- category throughput
- campaign performance

### Contacts

Main CRM list with filters for:

- category
- status
- campaign
- sequence state
- suppression state

### Queues

Operational lanes:

- Ready today
- Follow-up due
- Replied
- Suppressed
- Archived

### Campaigns

Show:

- send totals
- reply totals
- positive replies
- suppression rate
- category performance

### Imports

Each upload should show:

- imported
- deduped
- invalid email
- skipped rows
- first few reject reasons

### Contact Detail

Priority order:

1. draft
2. company
3. short description
4. follow-up schedule
5. activity timeline

## Drafting Rules

### Initial Email

- category-specific template
- personalize with:
  - company name
  - description
  - role/category context
- use `Hello` instead of a name when the mailbox looks generic, such as `info@...`
- include phone and website in the signature
- always include the About Us PDF attachment

### Follow-ups

- short and contextual
- same thread when possible
- exactly two follow-ups:
  - day 3
  - day 14

## Automation Rules

### Daily send logic

- Weekdays only
- Run once at 11:00 AM ET
- Process categories in the configured priority order
- Each category gets 10 sends per day
- Follow-ups get priority over initials within a category

### Send gating

Block sending if:

- contact is suppressed
- contact replied
- contact bounced
- company/domain is suppressed
- a prior initial already exists for the same normalized email

## Immediate Rebuild Phases

### Phase 1: Import reliability

- Support comma, semicolon, and tab-delimited CSV
- Return import diagnostics by reason
- Dedupe by normalized email inside each file
- Surface skipped reasons clearly in UI

### Phase 2: Real CRM model

- Split contact/company/suppression concerns
- Add proper sequence-step records
- Add category and campaign metrics

### Phase 3: Automation engine

- Use one scheduler for prospects
- Prioritize follow-ups before initials
- Enforce per-category daily caps
- Keep thread continuity for follow-ups

### Phase 4: UI rebuild

- Replace current editorial/prospect queue feel
- Build a pragmatic operations CRM
- Make imports, metrics, queues, and contact detail first-class

## Current First Slice Already Started

- Prospect draft generation is being upgraded to stronger production-ready copy
- CSV parsing now supports more export formats
- Import pipeline now reports skipped rows with reasons
