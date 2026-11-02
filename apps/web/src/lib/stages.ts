/** What each upload stage means to the person looking at it, and whether they need to act. */
export type Tone = 'success' | 'warning' | 'error' | 'neutral';

export const STAGES: Record<string, { label: string; tone: Tone; hint: string }> = {
  imported: { label: 'Imported', tone: 'success', hint: 'Rows saved.' },
  queued: { label: 'Importing', tone: 'neutral', hint: 'Being read now.' },
  stored_file_only: { label: 'Stored', tone: 'neutral', hint: 'PDF kept as a file: no reader knows its layout, so it has no rows.' },
  needs_confirmation: { label: 'Needs confirmation', tone: 'warning', hint: 'Check the warnings and confirm.' },
  needs_template: { label: 'Needs template', tone: 'warning', hint: 'A report this workspace hasn’t set up yet: confirm its columns once.' },
  needs_reference_date: { label: 'Needs report period', tone: 'warning', hint: 'This export doesn’t say which day or week it covers; pick it.' },
  failed: { label: 'Failed', tone: 'error', hint: 'Could not be read.' },
  rejected: { label: 'Rejected', tone: 'error', hint: 'Not stored.' },
};

/** Held for a person: the upload waits until someone answers. */
export const HELD = new Set(['needs_confirmation', 'needs_template', 'needs_reference_date']);

export const stageOf = (stage: string) => STAGES[stage] ?? { label: stage, tone: 'neutral' as Tone, hint: '' };
