/**
 * Who this ward is, and the handful of links the public page points at.
 *
 * One place rather than inline strings in the landing page, because the same
 * facts are also the site's metadata and the installed app's name — a ward
 * boundary realignment renames all three from here.
 *
 * Everything in this file is public by definition: it is what a visitor who has
 * never signed in is shown. No member data belongs here.
 */

export const WARD = {
  name: 'Scenic Sunrise Ward',
  stake: 'Long Valley Stake',
  city: 'Washington',
  state: 'Utah',
  /** 'Washington, Utah · Long Valley Stake' — the line under the ward name. */
  get location() {
    return `${this.city}, ${this.state} · ${this.stake}`
  },
} as const

/** Where the ward meets, and when. */
export const MEETINGS = {
  address: '1835 S Washington Fields Rd',
  cityStateZip: 'Washington, UT 84780',
  /** Sacrament meeting first, then the second hour. */
  schedule: 'Sundays, 12:00 – 2:00 p.m.',
  /**
   * Apple Maps and Google Maps both take a `q=` address, and both hand off to
   * the native app on a phone. A `geo:` URI would too, but it drops the label.
   */
  get mapsUrl() {
    return `https://maps.google.com/?q=${encodeURIComponent(`${this.address}, ${this.cityStateZip}`)}`
  },
} as const

/**
 * Scheduling for bishopric interviews.
 *
 * A Google Appointment Schedule for now — the bishopric owns the calendar and
 * the slots, and nothing in this app has to know the roster to make it work.
 * If it is replaced, this constant is the only thing that changes.
 */
export const INTERVIEW_SCHEDULING_URL = 'https://calendar.app.google/pCgrcqjfzqHuGQ2f8'

/**
 * The weekly ward announcements.
 *
 * A Google Doc the clerk keeps, so the link is stable while the contents change
 * every week — which is the whole reason it earns a card of its own rather than
 * a row in the link list below. The `#heading=` anchor the URL was shared with
 * is dropped on purpose: it jumps to whichever section the sharer was reading,
 * and somebody opening this from the ward page wants the top of the document.
 */
export const ANNOUNCEMENTS_URL =
  'https://docs.google.com/document/d/1s1ZmFBzdbVnA6HWuFkG23j3flRovp7ShWwgi-EXs-HM/edit?tab=t.0'

export type PublicLink = {
  label: string
  /** One sentence on why somebody would tap it. */
  description: string
  url: string
}

/** The links on the public page, in the order they are shown. */
export const PUBLIC_LINKS: readonly PublicLink[] = [
  {
    label: 'Gospel Living app',
    description:
      'How the ward communicates. Circles carry the announcements, event details and reminders for each organization — install it and ask to be added to yours.',
    url: 'https://www.churchofjesuschrist.org/youth/childrenandyouth/gospel-living-app?lang=eng',
  },
  {
    label: 'Member Tools & ward directory',
    description:
      'The official directory, calendar and callings, for members with a Church account.',
    url: 'https://www.churchofjesuschrist.org/my-home?lang=eng',
  },
  {
    label: 'Meetinghouse locator',
    description: 'Meeting times and directions for any ward, including this one.',
    url: 'https://maps.churchofjesuschrist.org/',
  },
  {
    label: 'ChurchofJesusChrist.org',
    description: 'Scriptures, general conference talks, the Gospel Library and Come, Follow Me.',
    url: 'https://www.churchofjesuschrist.org/?lang=eng',
  },
]
