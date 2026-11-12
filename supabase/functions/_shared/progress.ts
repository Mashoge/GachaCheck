// The one rule for "is this task done?", shared by the app and the reminder job.

import { countIn, dailyPeriod, taskPeriod, weeklyPeriod, type ResetClock, type TaskRule } from './time.ts'

export type ProgressTask = TaskRule & { weekly_target: number | null }

export type Progress = {
  period: ReturnType<typeof taskPeriod> // the window ticks count for (null = no dates yet)
  count: number // ticks in that window
  target: number // ticks needed (1, or the weekly target)
  done: boolean
  today: boolean // a "N days a week" daily already ticked today
  doneForNow: boolean // done, or nothing more to do until tomorrow
}

// Tasks with a weekly target ("5 days a week") count across the week; a daily one can be ticked once a day.
export function progress(task: ProgressTask, completedAts: string[], clock: ResetClock, now: Date): Progress {
  const counted = task.weekly_target != null
  const period = counted ? weeklyPeriod(clock, now) : taskPeriod(task, clock, now)
  const count = period ? countIn(period, completedAts) : 0
  const target = task.weekly_target ?? 1
  const done = count >= target
  const today = counted && task.frequency === 'daily' ? countIn(dailyPeriod(clock, now), completedAts) > 0 : false
  return { period, count, target, done, today, doneForNow: done || today }
}
