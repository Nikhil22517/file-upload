# Coaching module: review questions

Source: *LMDmax Unified Platform Functional PRD v2.0 (7 Oct 2026)*, Chapter 9 (F-COACH-1 to F-COACH-10). Also read: chain 16.8 (the coaching loop), F-PERF-7, 9, 11 and 15, F-WFL-6 and F-WFL-8, the catalogues in 17.1 and 17.4, and decisions D1, D10 and Q4.

Status of the chapter per 18.3: 29 sub-features, 14 Built, 7 Partial, 8 Planned. Code coverage is 72%, which is lower than Performance at 88%.

---

## How Coaching links to the rest of the platform

```
 SIGNALS (in)                                   COACHING                                 DELIVERY / OUT
 F-PERF-11 watchlist (B1–B4) ─┐
 F-PERF-14 safety events ─────┼─► F-COACH-2 Opportunities ─┐
 F-PERF-14 daily POD ─────────┘   (computed on read)       │
 F-PERF-7 drill "Coach" ───────────────────────────────────┼─► F-COACH-1 Coaching task ──► F-COMM-2 chat card (always if notify)
 F-PERF-9.4 path-to-tier "Coach" ──────────────────────────┤   (type = coaching)           F-COMM-3 SMS (opt-in, F-FND-8 gate)
 F-PERF-12.3 risk alert link ──────────────────────────────┤                               email (opt-in)
 Driver profile (F-WF-3) ──────────────────────────────────┘                               F-COMM-12 resource tiles
                                                                │
 F-COACH-3 templates ─► F-COACH-4 Write-ups / documents ────────┼──► F-PORT-8 To sign, F-PORT-2 Coaching channel
 F-COACH-6 doc types ─┘   (write-up, ack, notice, custom)       │    F-COACH-5 sign/decline (token link or portal)
                                                                │
                                                                ├──► F-WF-4 Timeline, F-HOME-1 band, F-HOME-4 Command Center
                                                                ├──► F-COACH-7 follow-up reminder (02:00 UTC)
 F-PERF-6 weekly records ──► F-COACH-8 Outcome (Mon 03:00 UTC) ─┴──► F-COACH-9 / F-PERF-15 effectiveness, F-PERF-11 coaching density
 F-OPS-4 legal wall: staff can read, but cannot create, issue, sign or recompute anything
```

---

## A. Contradictions inside the PRD (resolve these before building)

| # | Where | What conflicts | Question |
|---|---|---|---|
| A1 | Chain 16.8 step 3 vs F-COACH-4.1/4.3 vs F-COACH-10.1 | The chain says sending a document emits **`writeup.sent`**. F-COACH-4 says no domain event is emitted, only chat realtime signals. F-COACH-10.1 introduces a new event, **`writeup.issued`**. | Which events exist, what are they called, and who subscribes? |
| A2 | F-WFL-8 (line ~15139) vs F-COACH-1.3 | A planned recipe is triggered by **`coaching_task.closed`**, but resolve and dismiss emit nothing. | Should F-COACH-1.3 emit this event now, so the planned recipes have a hook? |
| A3 | Chain 16.8 step 6 vs F-COACH-8 vs F-COACH-10.3 | There are three outcome vocabularies: "improved / held / worsened" in the chain; "improved / no change / declined" with a **2%** band over scorecard weeks in F-COACH-8; and "improved / held / worsened / no data" with **10%** thresholds over 28 days in F-COACH-10.3. | Will both systems run at once? Which one feeds the effectiveness percentage, the watchlist's coaching density and the escalation suggestions? When 10.3 ships, is historical data migrated or re-scored? |
| A4 | F-COACH-8.1 | PSB is listed as **higher is better**, but in Performance (F-PERF-5.1) it is lower is better. | This would invert every PSB outcome. Confirm it's a bug. |
| A5 | F-COACH-4 shared rules vs F-COACH-1.3 | "A document is **never edited after issue**", yet coaching tasks *are* documents and their note, title and category can be edited, which rewrites the body. | Can a signed coaching document still be edited? If so, the signature applies to text that has since changed. |
| A6 | F-COACH-5.1/5.2 | The portal tells the driver "**Your team has been notified**" after they sign or decline, but no notification is sent. | This false promise is live today. Fix the copy now, or ship the notification first? |
| A7 | F-COACH-1.3 | Resolve and Dismiss are shown to `create_task` holders but enforced against `create_document`, so a Dispatcher's click fails. `coaching:close_task` exists but checks nothing. | Confirm the fix: gate all three transitions on `close_task`, and add it to every role template that has `create_task`. |
| A8 | F-COACH-1.1 | A Dispatcher can create a coaching task, but "Request driver signature" issues a **document**, which needs `coaching:create_document`. Dispatchers can't issue documents. | Should a Dispatcher who ticks "Request signature" be blocked, or is signing on a coaching document exempt? |
| A9 | F-COACH-4.4 vs F-COACH-5.2 | Home's "write-ups awaiting signature" counts **non-coaching** documents only. The portal's To sign channel counts **all** pending documents, including signable coaching. | The manager's count and the driver's count will differ. Is that intended? |
| A10 | F-COACH-2.1 vs F-PERF-11 | The opportunity bands are High ≥ 0.66 and Medium ≥ **0.40**. The watchlist uses Medium ≥ **0.33**. | The same driver can show Medium on one screen and Low on the other. Should the bands be unified? |
| A11 | F-COACH-2.2 | The praise "Recognize" action is said to sit on F-PERF-15, which is the insights tab. The action actually lives on the drill (F-PERF-7). | Fix the reference? |
| A12 | F-COACH-10.5–10.8 vs the current data model | Planned recipes create coaching tasks with a **topic** (for example "performance decline") and a **severity** (informational, verbal, written). Coaching tasks today have only a category and a metric key; only write-ups have a level, and "verbal" is a write-up level. | Will severity and topic be added to the coaching type? How are a "verbal coaching" and a "verbal warning write-up" kept apart in data, in the user interface and legally? |
| A13 | F-COACH-10.8 | Owner review "disables **Send**" on a recipe-created task. Coaching tasks have no Send step today; delivery happens at creation through notify. Send and Resend exist only for documents, under `send_writeup`. | What does Send mean for a coaching task, and which permission gates it? |
| A14 | F-COACH-6 | The Document types page and its endpoint are owned by the **workforce.documents** entitlement, not by coaching. | Can a company with coaching but without workforce.documents create custom types? The composer falls back silently to the built-in list. |

---

## B. How each feature gets built

### B1. Coaching tasks and the queue (F-COACH-1)
1. The manual picker accepts overall standing, FICO, attendance and conduct, which "are stored but never scored". Should the dialog warn that these will never have an outcome?
2. Delivery is "best effort after creation". If the chat post fails, is there a retry? Does the manager see "not delivered"? D1 says every failure records why.
3. The queue lists at most **500** coaching documents and has no pagination. What happens for a DSP with 150 drivers after a year?
4. The repeat count includes **dismissed** tasks for 84 days, so a coaching dismissed by mistake still counts as a repeat. Once escalation suggestions (10.5) ship, it could also trigger escalation. Should dismissed tasks be excluded?
5. Dismiss has no reason today. The requirement says the reason is optional. For HR defensibility, should it be required?
6. None of the create, edit, resolve, dismiss or reopen actions write an audit row. Is the standard mutation audit an alpha blocker?

### B2. Opportunities (F-COACH-2)
7. Watchlist opportunities are keyed by **behaviour** (tier drop, safety behaviour, attendance, retention), and F-COACH-8 never scores behaviour keys. The biggest source of coaching can therefore never be measured. Should a behaviour be mapped to its dominant metric when the task is created?
8. Suppression only matches the same key. A coaching on "speeding" does not suppress a "safety behaviour" opportunity for the same driver. Should related keys suppress each other?
9. The safety-event source can only reinforce an existing row, never create one. If the watchlist read fails, should safety events stand on their own?
10. Opportunities are computed on every read from three sources. What is the latency budget for a 150-driver company? Is caching planned?

### B3. Templates and document types (F-COACH-3, F-COACH-6)
11. Two APIs and two permissions (`edit_template` and `edit_writeup_template`) write to **one table**. Should the simpler coaching-template API be deprecated?
12. Variables aren't substituted today, so "{first}" reaches the driver literally. How many existing company templates already contain tokens that will start rendering when this is fixed?
13. A coaching template tied to a metric doesn't override the built-in knowledge-base text. Once it does, which wins when there are two non-archived templates for the same metric?
14. A custom type can't be un-archived, and its code is reserved forever. Is that acceptable?
15. LMDmax staff can edit templates and types ("not restricted by the legal wall") but can't issue documents. Should staff edits to a customer's disciplinary templates be audited and visible to the customer?

### B4. Documents, delivery and signature (F-COACH-4, F-COACH-5)
16. **E-signature validity:** the signature is a typed name plus a checkbox, reached through a token link with **no expiry** and **no sign-in**. Has legal confirmed this meets ESIGN/UETA, and the stricter rules of any state where the alpha DSP operates? Is consent to electronic records captured?
17. An SMS link carries disciplinary content and the driver's name, and resolves "across tenants under the platform bootstrap context". If the SMS is forwarded, anyone can read it and sign as the driver. Is a second factor needed, such as the last 4 digits of the phone or a portal session?
18. The open log records timestamps only. Should it also record IP address and user agent as signature evidence?
19. Decline reasons are free text today and a fixed list in the requirement. Should existing free-text declines be migrated or left as they are?
20. Resend sends the in-app notice only. Is the gap (no SMS or email on resend, no skip reason shown) needed for the alpha?
21. A termination recommendation has no confirmation and no link to an employment record (F-WF-5). Who acts on it, and does anything in Workforce change?
22. Documents and SMS are in English only. Do the alpha DSP's drivers need Spanish or other languages for legally binding documents?
23. What is the retention policy for disciplinary documents and signatures after a driver leaves? (D5 covers rescue data only.)

### B5. Reminders, outcomes and analytics (F-COACH-7, 8, 9)
24. The follow-up reminder runs at **02:00 UTC**, and "due" means on or before the start of today **in UTC**. For a US manager, a follow-up date of Tuesday is reported on Monday evening. Should due dates follow the company's timezone?
25. The reminder goes to the Owner, General Manager and Ops Manager, not to the **issuer** of the task. Should the issuing manager be the primary recipient?
26. Outcomes don't roll across the year boundary ("verify"). Coaching in weeks 51–53 could stay pending forever. Is a fix needed?
27. Maturity is reached when "any driver record ≥ W+2 exists" company-wide. A driver on leave in W+1 and W+2 then scores from a single week, or stays pending. Is that intended?
28. A recompute is allowed for `create_task` holders, Dispatchers included. Should backfill be Owner-only?
29. The Manager performance chart derives the manager's name **from their email address**. Why not use the account's display name? Is ranking individual managers' effectiveness acceptable to the customer?

### B6. Planned (F-COACH-10)
30. D10 (first-event seatbelt and OSS-drop coaching) is decided but not built. Is it in the **alpha** scope? It depends on the import events, which no subscriber consumes today.
31. A seatbelt event can create a task under 10.8, a cluster task under 10.7, a cluster notification under F-PERF-12.2 and a watchlist alert under F-PERF-12.3, all for the same events. What is the overall de-duplication rule, so a Safety Manager isn't notified four times for one driver?
32. 10.7 excludes "disputed events", but disputes (F-PERF-16.5) are roadmap under Q4. Can 10.7 ship before disputes?
33. The 10.3 efficacy window anchors on **delivery**, but there is no delivered timestamp for in-person coaching until "Mark delivered" ships (10.9). Which ships first?
34. 10.4 needs at least 50 scored uses per template before showing a percentage. One DSP may never reach 50. Should statistics be pooled across companies for the platform templates?
35. 10.2 generates PDFs. Which library is used? Are PDFs regenerated after the witness signs, or versioned? Where are they stored, and are they immutable?
36. 10.9 auto-send is Owner-only. If it's switched on, recipe-created disciplinary-adjacent messages go out with no human review. Has legal signed off?
37. Q-new-2 says no module settings pages ship before the alpha, yet 10.1, 10.2, 10.5, 10.7 and 10.8 all read 10.9. Do the hard-coded defaults suffice until then?

---

## C. How other modules use Coaching (integration questions)

| Consumer or provider | Question |
|---|---|
| **Performance (F-PERF-7, 9.4, 11)** | Drill "Coach" creates a task with an optional driver notification. Is notify on or off by default from the drill, from the path-to-tier card and from the watchlist? |
| **Performance (F-PERF-15)** | The insights tab requires `performance:view`, and the same data in F-COACH-9 requires coaching. Should a company with coaching but **without** performance see effectiveness at all? (Outcomes need F-PERF-6 records.) |
| **Communication (F-COMM-2, 3)** | Coaching and write-up cards are high-priority alert messages. Do they bypass quiet hours (F-FND-8)? Do coaching SMS count against the same daily cap as scorecard distribution and the digest? |
| **Communication (F-COMM-12)** | Resource tiles need the communication entitlement. If it's off, is a coaching with linked resources sent without tiles, silently? |
| **Driver portal (F-PORT-2, 8)** | The driver role holds `coaching:view`, the same code managers use. Are all manager endpoints (queue, write-ups list, effectiveness) protected by more than this permission? |
| **Workforce (F-WF-3, 4, 5, 9)** | A termination recommendation or suspension has no link to employment status. Should issuing one prompt the F-WF-5 status change? Should signed PDFs (10.2) go into F-WF-9 driver documents, and under which document type? |
| **Workforce (F-WF-8)** | Can provisional ("Not added") drivers be coached? Performance hides Coach for them, but F-COACH-2 only "flags" them. |
| **Schedule (F-SCH-9)** | Callouts feed the watchlist's attendance and retention scores and the planned 10.7. Is an attendance write-up expected to cite specific callouts? |
| **Home (F-HOME-1, 2, 4)** | The planned escalation suggestions go to the Action Center (F-HOME-2). Is F-HOME-2 Built? Who can dismiss an item there? |
| **Ops console (F-OPS-4, 10)** | Staff can read every coaching document. Is reading disciplinary documents logged per staff member, and visible to the customer? |
| **Workflow library (F-WFL-6, 8)** | Five new coaching recipes are planned. What is their default state for an existing company: off, active with review, or active? |

---

## D. How each user is expected to use it

1. **Owner:** What is the expected weekly rhythm? For example: scorecard lands Wednesday → opportunities Thursday → coach by Friday → outcome three weeks later. Should the product guide this?
2. **General Manager vs Safety/HR Manager:** Both can issue write-ups. Who owns progressive discipline? Is there an approval step before a Final warning or a Termination recommendation?
3. **Dispatcher "in coach capacity":** Dispatchers can create tasks but not documents, and can't resolve tasks today. What is the intended scope? Coaching at morning stand-up only?
4. **Ops Manager:** They receive follow-up reminders but can't issue write-ups or resend. Is that the right split?
5. **Driver:** A driver can't see outcomes, can't add a statement (planned only), and can't dispute (roadmap). What should a driver who disagrees do today? Is "Decline" the only channel?
6. **Witness (planned):** Any account of the company can be a witness. Should a Dispatcher or another driver's supervisor be allowed?
7. **HR or legal reviewer:** Is a full disciplinary-history export per driver (all documents, signatures and open logs) needed for unemployment or legal claims?
8. **Success metric for the alpha:** What should be measured? For example: share of coachings delivered within 48 hours of a signal, signature rate, effectiveness percentage, or repeat-coaching rate.

---

## E. Acceptance-criteria gaps that will block QA

- There is no criterion for **audit rows**, even though the chapter states every mutation needs one. Add one Given/When/Then per transition.
- The year-boundary behaviour in F-COACH-8 is marked "verify" and is untestable until it's decided.
- There are no criteria for timezone and DST edges on follow-up due dates.
- There are no load criteria: queue and list caps at 500, analytics at 2,000, outcomes at 1,000 per run.
- There are no negative tests for token links: forwarded links, links to an archived company, or a disabled coaching entitlement on a link that has already been issued.
