// THM-10: every page's shared copy in one place. Once the app is open, the pages you haven't visited yet
// load quietly in the background (skipped with Data saver), so opening them is instant too; signing out
// forgets them all, so the next account never sees them.
import { eventsData } from './events'
import { gamesData } from './games'
import { reminderData } from './reminderSettings'
import { forgetTodayData } from './today'

export function prefetchAppData() {
  for (const store of [gamesData, eventsData, reminderData]) void store.refresh().catch(() => {}) // a page shows its own error when opened
}

export function forgetAppData() {
  forgetTodayData()
  gamesData.clear()
  eventsData.clear()
  reminderData.clear()
}
