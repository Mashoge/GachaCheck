import { describe, expect, it } from 'vitest'
import { progress } from '../../supabase/functions/_shared/progress'
import { groupCompletionRows, nonResettingTaskIds } from './completionHistory'

describe('non-resetting goal completions', () => {
  it('selects only tasks whose progress uses the lifetime period', () => {
    const ids = nonResettingTaskIds([
      {
        tasks: [
          { id: 'daily', frequency: 'daily', weekly_target: null, archived: false },
          { id: 'weekly-target', frequency: 'none', weekly_target: 5, archived: false },
          { id: 'goal', frequency: 'none', weekly_target: null, archived: false },
          { id: 'archived-goal', frequency: 'none', weekly_target: null, archived: true },
        ],
      },
    ])

    expect(ids).toEqual(['goal'])
  })

  it('keeps a goal completion older than the 62-day recent window', () => {
    const goalTaskIds = new Set(['goal'])
    const completions = groupCompletionRows(
      [],
      [{ id: 'old-goal-completion', task_id: 'goal', completed_at: '2026-06-01T08:00:00.000Z' }],
      goalTaskIds,
    )

    const goalCompletions = completions.get('goal') ?? []
    expect(goalCompletions).toEqual([
      { id: 'old-goal-completion', at: '2026-06-01T08:00:00.000Z' },
    ])

    const result = progress(
      { frequency: 'none', monthly_day: null, cycle_anchor: null, cycle_days: null, cycle_ends_at: null, weekly_target: null },
      goalCompletions.map((completion) => completion.at),
      { timezone: 'Etc/GMT-8', daily_reset_time: '04:00', weekly_reset_day: 1 },
      new Date('2026-11-14T09:00:00.000Z'),
    )
    expect(result.done).toBe(true)
  })

  it('combines recent completions with lifetime goal history in chronological order', () => {
    const completions = groupCompletionRows(
      [
        { id: 'recent-daily', task_id: 'daily', completed_at: '2026-11-13T08:00:00.000Z' },
        { id: 'recent-goal', task_id: 'goal', completed_at: '2026-11-13T09:00:00.000Z' },
      ],
      [
        { id: 'old-goal', task_id: 'goal', completed_at: '2026-05-01T08:00:00.000Z' },
        { id: 'recent-goal', task_id: 'goal', completed_at: '2026-11-13T09:00:00.000Z' },
      ],
      new Set(['goal']),
    )

    expect(completions.get('goal')).toEqual([
      { id: 'old-goal', at: '2026-05-01T08:00:00.000Z' },
      { id: 'recent-goal', at: '2026-11-13T09:00:00.000Z' },
    ])
    expect(completions.get('daily')).toEqual([
      { id: 'recent-daily', at: '2026-11-13T08:00:00.000Z' },
    ])
  })

  it('does not add lifetime rows for tasks outside the non-resetting task set', () => {
    const completions = groupCompletionRows(
      [],
      [{ id: 'old-daily', task_id: 'daily', completed_at: '2026-06-01T08:00:00.000Z' }],
      new Set(['goal']),
    )

    expect(completions.size).toBe(0)
  })
})
