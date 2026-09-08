import Link from 'next/link'
import { currentUser } from '@/lib/auth'
import SignInDialog from '@/components/SignInDialog'
import {
  ANNOUNCEMENTS_URL,
  INTERVIEW_SCHEDULING_URL,
  MEETINGS,
  PUBLIC_LINKS,
  WARD,
} from '@/lib/ward'

/**
 * The public front door.
 *
 * Everything above this in the tree used to be the signed-in dashboard, which
 * meant an unauthenticated visitor's first and only view of the site was a
 * password prompt. The dashboard now lives at /dashboard behind the (app) gate,
 * and this page holds what somebody who has never signed in actually needs:
 * where and when the ward meets, how to book an interview, and the handful of
 * links the ward tells people about over the pulpit.
 *
 * Nothing here reads member data. `currentUser` is consulted for one reason —
 * so a signed-in member gets a link into the app instead of a sign-in prompt
 * they do not need. That makes the page dynamic; it is one small render and the
 * alternative is showing everybody the wrong button.
 */
export const metadata = {
  title: `${WARD.name} — ${WARD.city}, ${WARD.state}`,
  description: `Meeting times, bishopric interview scheduling and ward links for the ${WARD.name}, ${WARD.stake}, in ${WARD.city}, ${WARD.state}.`,
  robots: { index: true, follow: true },
}

export default async function LandingPage() {
  const user = await currentUser()

  return (
    <div className="min-h-dvh bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-neutral-900">{WARD.name}</p>
            <p className="truncate text-sm text-neutral-500">{WARD.location}</p>
          </div>
          {/* Signed in already: the button that helps is the one into the app. */}
          {user ? (
            <Link
              href="/dashboard"
              className="inline-flex min-h-11 shrink-0 items-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white transition hover:bg-neutral-700 sm:min-h-9"
            >
              Ward tools
            </Link>
          ) : (
            <SignInDialog />
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10 sm:py-14">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900 sm:text-4xl">
          Welcome to the {WARD.name}.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-neutral-700">
          We are a congregation of The Church of Jesus Christ of Latter-day Saints in{' '}
          {WARD.city}, {WARD.state}, part of the {WARD.stake}. A ward is defined by where people
          live, so if your home is inside our boundary, this is your ward — and whether it is or
          not, you are welcome at anything on this page. Come as you are; there is nothing to join
          and nothing to pay to attend.
        </p>

        {/* First of the three cards, because it is the only one whose contents
            change from week to week — the meeting time and the scheduling link
            are the same every Sunday, and somebody checking this page mid-week
            is almost always checking the announcements. */}
        <section aria-labelledby="announcements" className="mt-10">
          <h2
            id="announcements"
            className="text-xs font-semibold tracking-wide text-neutral-500 uppercase"
          >
            This week
          </h2>
          <div className="mt-3 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-sm leading-relaxed text-neutral-700">
              Ward announcements — what is happening this week, upcoming events, and anything read
              over the pulpit on Sunday. Updated each week, so it is worth a look before you come.
            </p>
            <a
              href={ANNOUNCEMENTS_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex min-h-11 items-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white transition hover:bg-neutral-700 sm:min-h-9"
            >
              Read the announcements
            </a>
            <p className="mt-3 text-xs text-neutral-500">Opens a Google Doc in a new tab.</p>
          </div>
        </section>

        <section aria-labelledby="meet" className="mt-10">
          <h2 id="meet" className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            Sunday meetings
          </h2>
          <div className="mt-3 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-lg font-semibold text-neutral-900">{MEETINGS.schedule}</p>
            <p className="mt-2 text-sm leading-relaxed text-neutral-700">
              {MEETINGS.address}
              <br />
              {MEETINGS.cityStateZip}
            </p>
            <p className="mt-3 text-sm text-neutral-600">
              Sacrament meeting first, then classes and quorums for the second hour. Visitors do
              not need to bring or do anything.
            </p>
            <a
              href={MEETINGS.mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex min-h-11 items-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-800 transition hover:border-neutral-900 sm:min-h-9"
            >
              Get directions
            </a>
          </div>
        </section>

        <section aria-labelledby="interviews" className="mt-10">
          <h2
            id="interviews"
            className="text-xs font-semibold tracking-wide text-neutral-500 uppercase"
          >
            Schedule an interview
          </h2>
          <div className="mt-3 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-sm leading-relaxed text-neutral-700">
              Pick your own time with the bishop or a member of the bishopric — tithing
              declaration, a temple recommend, a calling, or anything else you would like to talk
              through. The calendar shows only times that are actually open, so there is no waiting
              in the hallway and no need to catch anyone after church.
            </p>
            <a
              href={INTERVIEW_SCHEDULING_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex min-h-11 items-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white transition hover:bg-neutral-700 sm:min-h-9"
            >
              Book a time
            </a>
            <p className="mt-3 text-xs text-neutral-500">
              Opens Google Calendar scheduling in a new tab.
            </p>
          </div>
        </section>

        <section aria-labelledby="links" className="mt-10">
          <h2 id="links" className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            Links
          </h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {PUBLIC_LINKS.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="group rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-neutral-900"
              >
                <h3 className="text-base font-semibold text-neutral-900">
                  {link.label}
                  <span aria-hidden className="ml-1 text-neutral-400 group-hover:text-neutral-900">
                    ↗
                  </span>
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-neutral-600">{link.description}</p>
              </a>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-6 py-6">
          <p className="text-xs text-neutral-500">
            {WARD.name} · {WARD.stake} · An unofficial site maintained by the ward.
          </p>
          {/* The signed-in half of the site, for anyone whose calling needs it. */}
          {!user && (
            <Link
              href="/login"
              className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
            >
              Ward tools sign in
            </Link>
          )}
        </div>
      </footer>
    </div>
  )
}
