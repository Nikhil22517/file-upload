# Performance module: review questions

Source: *LMDmax Unified Platform Functional PRD v2.0 (7 Oct 2026)*, Chapter 8 (F-PERF-1 to F-PERF-16). Also read: chains 16.1, 16.2, 16.8 and 16.18, F-WFL-5, F-COACH-2, F-COACH-8, F-PORT-5 and the decisions in 18.1 and 18.2.

Status of the chapter per 18.3: 52 sub-features, 40 Built, 6 Partial, 6 Planned.

---

## How Performance links to the rest of the platform

```
           Amazon / Netradyne files (21 report codes)
                         │
   F-FLT-15 trips ──► F-PERF-1 Ingestion ──► F-PERF-2 Parsers ──► F-PERF-3 Attribution ──► F-WF-8 provisional drivers
                         │
                         ▼
        F-PERF-14 daily records ─┬─► F-PERF-9 Prediction ──► F-HOME-4 Command Center tile
        F-PERF-4/6 weekly records├─► F-PERF-7 Metric drill ──► Coach (F-COACH-1) / Message (F-COMM-2)
                                 ├─► F-PERF-11 Watchlist ◄── F-SCH-9 callouts, F-COACH-4 write-ups, F-WF-5 hire date
                                 │        └──► F-COACH-2 opportunities, F-PERF-12.3 risk alert
                                 ├─► F-PERF-12 recipes (02:00 UTC) ──► F-FND-8 notifications ──► F-HOME-1 band
                                 ├─► F-PERF-13 digest ──► driver chat + SMS (F-COMM-2/3) ──► F-PORT-2 channel
                                 ├─► F-PERF-10 distribution ──► chat + SMS ──► F-PORT-5 My scorecard, F-OPS-9/10
                                 └─► F-COACH-8 outcomes (Mon 03:00 UTC) ──► F-PERF-15 Coaching insights
```

---

## A. Contradictions inside the PRD (resolve these before building)

| # | Where | What conflicts | Question |
|---|---|---|---|
| A1 | F-PERF-5.2 vs chain 16.1 step 4 vs F-PERF-16.3 | 5.2 caps CAS non-compliant at **48.99 (Fair)** but its standing gate says CAS "caps at **Great**". Chain 16.1 also says Great. The diagnoser (16.3) says **Fair**. | Which is right for CAS: Fair or Great? |
| A2 | F-PERF-5.2 | The default category weights are Safety 47.5, Quality 40, Pickup 5, Team 10. That adds up to **102.5**, not 100. The Quality leaf weights add up to only 31.3 against a category weight of 40. | Is Team 7.5? Where do the missing Quality leaf weights go (CED, PSB)? |
| A3 | F-PERF-5.2 acceptance criteria | "Categories 92.5, 68.8, 74, 75 with default weights give **80.3**". With the stated weights the result is 80.64, and with Team at 7.5 it is 80.78. | What inputs actually produce 80.3? The test will fail as written. |
| A4 | F-PERF-5.2 | The projection uses "exceed-not-meet" (above 88), but the stored-standing helper uses "at-or-above". | A score of exactly 88.00 would read Fantastic Plus on one screen and Fantastic on another. Which rule applies everywhere? |
| A5 | F-PERF-9.2 | The projection applies only the **Safety tier and Working Device** caps. | Is it intentional that CAS, Breach and capacity reliability are left out of the projection? Should the last scorecard's CAS or Breach carry forward? |
| A6 | F-PERF-12.1 vs F-WFL-5.1 | The tier-drop recipe uses a "five-rank scale" in one place and a 4-rank scale (Fantastic, Great, Fair, Poor) in the other. | Does Fantastic Plus → Fantastic count as a drop? |
| A7 | F-PERF-12.2 vs F-WFL-5.3 acceptance criteria | Safety cluster: one says "none tomorrow unless new events arrive"; the other says "re-fires next day under a new daily dedupe key with no new event". | Which behaviour is wanted? Re-firing daily for the same 7-day window could notify up to 7 times for one cluster. |
| A8 | F-PERF-6.1 vs chain 16.1 step 6 vs F-PERF-8 | "Drivers below target" on Home counts drivers whose **standing is below the top tier**. Chain 16.1 says "below **internal target**". | Which definition drives the Home count? The word "target" already means internal target in F-PERF-8. |
| A9 | F-COACH-8.1 | PSB is listed as **higher is better**. The driver model (F-PERF-5.1) treats PSB as lower is better (0/10/18/25). | This looks like a bug that would invert PSB coaching outcomes. Confirm? |
| A10 | Chain 16.8 step 6 vs F-COACH-8 / F-PERF-15 | The chain names the outcomes "improved, held, worsened". The feature names them "improved, no change, declined". F-COACH-8 also says a window matures when "any driver record ≥ W+2 exists", but pending applies when "fewer than two after-weeks" exist. | Which vocabulary is correct? Is maturity per driver or per company? |
| A11 | Chain 16.1 steps 9–10 vs F-PERF-16.4 | The chain is tagged Built and lists "read receipts" and "metric explainers" on the portal card. F-PERF-16.4 and 16.2 say both are **missing or Planned**. | Should the chain be re-tagged Partial? |
| A12 | F-PERF-2.1 | The upload dropdown hint says weekly reports reflect "the prior **Mon–Sun** week". Everywhere else the Amazon week is **Sun–Sat**. | Is the hint text wrong, or does one report really use Mon–Sun? |
| A13 | F-PERF-13 vs F-WFL-5.7 / F-PORT-5 | The digest lands in the "**Scorecard** channel" in one place and the "**Performance** channel" in another. | Which is the channel's name? |
| A14 | F-PERF-1.3 vs chain 16.1 step 3 | The batch runs inside one row-level-security (RLS) transaction, and "event emission is after the write". | Are events emitted after commit (an outbox) or inside the transaction? If a rollback happens after the emit, consumers see a phantom import. |
| A15 | F-PERF-12.3 vs F-COACH-2 vs F-PERF-11 | Severity bands differ: the watchlist uses medium ≥ 0.33, coaching opportunities use medium ≥ 0.40, and both use high ≥ 0.66. | Should the bands be unified? |
| A16 | F-PERF-5.2 inputs | A **capacity-reliability** miss caps the overall at 72.99, but no report in the 21-code catalogue supplies capacity reliability. | Where does this input come from? |

---

## B. How each feature gets built

### B1. Ingestion hub (F-PERF-1, F-PERF-2)
1. Up to 25 files × 25 MB go through parsing, attribution and writing **synchronously inside one request transaction**. What is the request timeout? Will a 25-file Monday batch hit it? Is there a plan to move this to a background job with progress reporting?
2. The DSP Scorecard PDF is "converted to a workbook". Which converter is used? Does it run server-side or as a third-party service? What happens when Amazon changes the PDF layout? Is there a golden-file regression set?
3. Detection runs every parser's cheap check. How are new parsers registered, and who owns updating the column-synonym groups when a column-drift warning appears?
4. F-PERF-1.4 re-import is Partial. Should the superseded flag be set **automatically** when a file covers the same code and period, or only through the explicit re-import action?
5. Re-import never deletes events missing from the new file. How does a manager remove a wrongly imported Netradyne alert, for example from another DSP's file confirmed by mistake?
6. Foreign-DSP checking uses "the company's first DSP code" when the station is unknown. How is a multi-DSP company handled?
7. F-PERF-1.6's "Expected Import Missing" daily alert is not built. Is it in scope for the alpha? Which timezone defines "end of day": the station's or the company's?
8. The weekly due day is "the configured weekday (Wednesday)". Where is it configured, per company or platform-wide?

### B2. Attribution and provisional drivers (F-PERF-3)
9. Package-level rows (Netradyne alerts, RTS, CDF, concessions) are **not re-pointed** when a driver is linked later ("verify"). The event digest, safety-cluster recipe, watchlist B2 and driver drill all miss those rows. Is a back-fill on link required?
10. Is fuzzy-match auto-accept at 0.85 safe for common names, for example two "Maria Garcia"s? Is there a tie-break or an audit of auto-matches?
11. Provisional drivers get a synthetic active employment at the default station. Do they count toward **seat or licence entitlements**, headcount KPIs or Workforce reports?
12. None of the resolution actions (link, create, ignore, confirm) writes an audit entry. Is that acceptable, given they change who gets coached for what?
13. "Ignore" applies only to the current pending set, so the same rescue driver reappears every week. Is a standing ignore rule needed?
14. Create-driver here does **not** emit the Workforce add-driver event. Which onboarding steps (invitation, documents, compliance) get skipped as a result?

### B3. Scoring engine (F-PERF-5)
15. Calibration is `1.474 × overall − 48.72`, fit to 73 scorecards. Whose scorecards were they? Is the fit global or per DSP? Who re-fits it "as weeks accumulate", how often, and how is the change versioned?
16. The default driver cut-offs are Platinum 100, Gold 88, Silver 85, Bronze 25. Platinum at 100 means almost nobody reaches it, and Silver at 85 sits just 3 points under Gold. Are these the real Amazon values?
17. "A DSP's own scoring metadata file can replace thresholds and weights." What is that file, who uploads it, and where in the product does that happen?
18. Appendix A weights are extracted per week from the scorecard text. If extraction fails for a week, does it fall back to the last week's weights or to the defaults?
19. CED, POD and PSB thresholds are marked "provisional". Who confirms them, and by when?
20. F-PERF-5.3's DC DPMO counterfactual is built but not surfaced anywhere. Which screen shows it first: the drill or the prediction outliers?

### B4. Company and driver lenses (F-PERF-4, 6, 7, 8)
21. A multi-station company shows "the lowest station code" for a week. Is that acceptable for the alpha DSP? Does it have more than one station?
22. Metric columns hide when fewer than a third of drivers have a value. Could that hide a critical POD problem in a week with sparse data?
23. FICO shows only if any driver in the company ever had FICO. Is that rule evaluated per company or per station?
24. The drill lists **active drivers only**. A terminated driver's defects still count in the company metric. Should the drill show "N defects from drivers no longer active"?
25. Internal targets: there is one target per company and metric. Is a per-station target needed after D3 (station as a hard RLS scope)?

### B5. Prediction (F-PERF-9)
26. Safety rate is "events ÷ routes × 100" with routes counted as distinct DA-days. Amazon's thresholds are **per 100 trips**. Is the DA-day the same as a trip? A partial daily report inflates the rate. Should a coverage gate apply before showing a tier?
27. Path to Fantastic Plus assumes a coached driver's defects drop to **zero**. Should it model a realistic improvement, for example using the measured coaching effectiveness from F-PERF-15?
28. The ±2.5 default band and the eight-week learned band apply company by company. A new DSP has no history. Should a platform-wide prior be used instead?
29. Pickup and Team carry from the last scorecard. What happens in the first week, before any scorecard exists?

### B6. Distribution and digest (F-PERF-10, F-PERF-13)
30. A driver who is not SMS-eligible gets **nothing**, not even the chat card. Why does the in-app chat card depend on SMS consent? Portal-only drivers would never receive their scorecard.
31. The channel is always "sms". Is email in scope? F-PERF-16.4 mentions email links.
32. The recipes run at **02:00 UTC**, which is the previous evening in US timezones. Morning uploads would be digested about 18 hours later. Should the scan run per company in local time, or run after each import?
33. The digest uses the "latest ingested quality day". If Monday and Tuesday are uploaded together, is Monday's digest skipped?
34. SMS quiet hours and the daily cap apply. If the cap blocks a digest SMS, is that recorded? Is the message retried?

### B7. Watchlist and recipes (F-PERF-11, F-PERF-12)
35. The B1 to B4 weights and saturation points (5 points a week, 8 alerts, 1.5 callouts) are hard-coded. Who validated them? Should they be tunable like the recipe parameters?
36. B4 "retention" uses tenure and write-ups. Has legal or HR reviewed using a predicted-attrition score on individual drivers, and who is allowed to see it?
37. A driver with no hire date defaults to a tenure of 104 weeks, which hides early-tenure risk. Should a missing hire date be flagged instead?
38. No subscriber consumes `scorecard.imported` and the related events today. Recipes wait for the nightly cron. Should the scorecard recipes fire on the import event instead?

### B8. Planned and Partial (F-PERF-16)
39. Q4 (disputes, leaderboards) defaults to "keep as roadmap". Is anything in F-PERF-16 needed for the **alpha DSP** (D6)?
40. Q-new-2 says no settings pages ship before the alpha. F-PERF-16.4 custom tier names and 16.8 tier override depend on 16.9 settings. Is that acceptable?
41. F-PERF-16.9 proposes rating weights for Safety, Quality, Compliance, Attendance and Tenure that must sum to 100. Which model uses them? They contradict the "Amazon's scoring, reproduced not invented" rule.
42. Tier override: "the driver sees the displayed tier without the override indication" is still open. Who decides, and does it carry legal risk?
43. Leaderboards reuse `performance:edit_thresholds`. Should `performance:manage_leaderboards` be created now?

---

## C. How other modules use Performance (integration questions)

| Consumer | Question |
|---|---|
| **Home (F-HOME-1, F-HOME-4)** | Home reads Performance on page load, not through events. What is the caching and latency budget when the band computes the standing, below-target count, unmatched rows and prediction in one load? |
| **Coaching (F-COACH-1, 2, 8)** | Coaching keys (behaviour keys, `pod`) differ from internal-target keys. Is there one canonical key list shared by Performance, Coaching and the recipes? |
| **Coaching (F-COACH-8)** | Outcomes don't roll over the year boundary ("verify"). Will coaching in weeks 51–52 stay pending forever? |
| **Coaching (D10, F-COACH-10)** | First-event safety coaching (seatbelt-off, OSS drop) is decided but not built. Will it subscribe to `safety_report.imported`, or scan nightly? |
| **Communication (F-COMM-2, 3)** | Drill "Message" sends SMS "where consented". Does it count against the same daily SMS cap as distribution and the digest? |
| **Driver portal (F-PORT-5)** | Drivers hold `performance:view`. Is every manager endpoint (roster, drill, watchlist) protected by more than that permission, so a driver token cannot read other drivers' data? |
| **Workforce (F-WF-3, 8)** | Provisional drivers live in Workforce tables but are hidden there. Who owns the "Add" modal: Performance or Workforce? |
| **Schedule (F-SCH-9)** | Callouts feed B3 and B4 by "recorded date". Should backdated callouts change last week's risk? |
| **Fleet (F-FLT-15)** | The Working Device trips import belongs to Fleet but caps the Performance prediction. If Fleet's import is missing, the last status carries. Should the prediction show "Working Device: carried"? |
| **Ops console (F-OPS-8, 9)** | A CSR can upload and distribute on behalf of a client. Should the uploader on the batch show the CSR or the impersonated user? Is the customer notified? |
| **Workflow library (F-WFL-5)** | Seven recipes default to active, dry-run, or off for a brand-new company? |

---

## D. How each user is expected to use it

1. **Owner:** Is the intended weekly routine Wednesday upload → Thursday distribution, with the prediction checked Tuesday? Should the product prompt that sequence, for example with a checklist on Home?
2. **General Manager:** Who resolves attribution, the GM or the Safety/HR Manager? The queue has no assignee.
3. **Safety Manager:** They receive cluster alerts but cannot set internal targets (`performance:edit_thresholds` is Owner/GM only). Is that intended?
4. **Dispatcher:** They can see the Company Scorecard but not the roster. What is the dispatcher's use case for Performance?
5. **Driver:** They get a scorecard card, a daily digest and My scorecard, but no way to question a number until disputes ship. What should the driver do today when they think a CDF is wrong?
6. **LMDmax CSR:** For a DSP that doesn't upload, will CSRs routinely upload on the DSP's behalf? If so, should a CSR upload need a reason and an audit trail?
7. **Success metric:** What does "the module works" mean for the alpha? Examples: upload-to-distribution time, prediction error within ±X, share of rows auto-attributed, coaching effectiveness.

---

## E. Acceptance-criteria gaps that will block QA

- F-PERF-5.2's 80.3 example doesn't reproduce (A3).
- The "verify" markers need answers before tests can be written: event subscribers (F-PERF-1.3), re-pointing package rows (F-PERF-3.3) and the coaching year boundary (F-COACH-8).
- There are no performance or load criteria: maximum rows per file, import time limits, and how fast the drill and projection respond for a 150-driver DSP over 104 weeks.
- There are no criteria for DST and timezone edges in the due-date and week-bucketing rules.
