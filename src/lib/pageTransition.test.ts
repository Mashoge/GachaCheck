import { describe, expect, it } from 'vitest'
import { pageTransitionClass } from './pageTransition'

describe('page entrances (THM-10)', () => {
  it('gives each game page its own entrance', () => {
    expect(pageTransitionClass('/game/genshin')).toBe('gc-page-genshin')
    expect(pageTransitionClass('/game/wuwa')).toBe('gc-page-wuwa')
    expect(pageTransitionClass('/game/nte/')).toBe('gc-page-nte')
  })

  it('uses the shared entrance everywhere else, including unknown games', () => {
    for (const path of ['/', '/games', '/events', '/reminders', '/game/other', '/gamestuff']) {
      expect(pageTransitionClass(path)).toBe('gc-page')
    }
  })
})
