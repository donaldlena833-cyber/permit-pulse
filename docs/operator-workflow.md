# Operator Workflow

## Purpose

This document describes how PermitPulse should be used today as an internal MetroGlass Pro operator console.

## Daily Loop

1. Open `Today`
2. Review send budget, backlog, reply sync freshness, and exceptions
3. Run a permit scan if needed
4. Send ready permit leads or due follow-ups
5. Run the prospect outreach batch if needed
6. Open exceptions and fix routing issues
7. Mark replies, bounces, opt-outs, wins, and losses

## Permit Lead Workflow

### 1. Ingest

- permit enters the queue as a new lead

### 2. Enrich

- worker resolves company candidates
- worker discovers contact candidates
- worker scores route quality

### 3. Review

Use `Leads` and `Lead Detail` to answer:

- is the company right
- is the contact route trustworthy
- is there a better manual email
- should this lead be parked in Email Required

### 4. Send

Only send when:

- the route is clear
- the workspace PDF is correct
- the mailbox state is known
- the daily cap and trust thresholds are acceptable

### 5. Follow Up

- let scheduled follow-ups run when enabled
- log phone outcomes when the follow-up lane is manual
- cancel the chain on reply, bounce, or opt-out

### 6. Close

Use outcomes to mark:

- replied
- bounced
- opted_out
- won
- lost
- archived

## Prospect Workflow

### 1. Import

- upload a CSV by category
- let the app dedupe and validate rows

### 2. Review Queue Health

Use `Outreach` to inspect:

- ready queue
- follow-up queue
- suppressions
- review items

### 3. Send and Monitor

- run the outreach batch
- sync replies
- mark positive replies, replies, bounces, and opt-outs

### 4. Maintain Memory

- keep notes current
- keep suppressions accurate
- use campaign and category metrics to see what is working

## Settings Workflow

Use `Settings` for:

- workspace identity
- sender copy
- workspace PDF library
- invite-only member access
- outbound safety thresholds
- audit trail review

## Mailbox Setup

Mailbox connection is manual by default in the current product mode.

That means:

- onboarding should not block the workspace solely on self-serve Gmail setup
- sender identity can be prepared in the UI
- actual inbox wiring happens through ops/deployment work when the workspace is ready

## Decision Rules

### When a permit lead is `ready`

- route is trustworthy enough to send
- operator has approved it or system evidence is strong enough

### When a permit lead is `review`

- company or contact evidence is incomplete
- there is a possible route, but it is not trustworthy enough yet

### When a permit lead is `email_required`

- no approved route exists
- operator intends to research the address manually later

### When outreach should stop

- reply
- opt-out
- bounce
- explicit suppression
- win/loss closure
