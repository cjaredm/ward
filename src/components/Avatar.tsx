'use client'

import { useState } from 'react'
import { avatarTint, initials, safePhotoUrl } from '@/lib/photo'

/**
 * A person's face, or their initials.
 *
 * One component for both, because the photo is the exception: most people have
 * none, and a photo whose host has moved on is the same situation a moment later.
 * So the initials are always what is underneath, and the image is a layer on top
 * that removes itself if it fails to load.
 */
export default function Avatar({
  name,
  photoUrl,
  size = 32,
  className = '',
}: {
  name: string | null
  photoUrl?: string | null
  /** Pixels, square. 32 in a list row, 56 in a detail header. */
  size?: number
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  const src = safePhotoUrl(photoUrl)
  const label = initials(name)

  return (
    <span
      aria-hidden
      title={name ?? undefined}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white select-none ${className}`}
      style={{
        width: size,
        height: size,
        // A vacancy has no name to seed a colour with, and should not look like a
        // person who happens to have no picture.
        backgroundColor: name ? avatarTint(name) : '#d4d4d4',
        fontSize: Math.round(size * 0.38),
        lineHeight: 1,
      }}
    >
      {name ? label : '·'}
      {src && !broken && (
        // Plain <img>: these are arbitrary third-party hosts, and putting every
        // one of them in next.config's image allowlist is a config change per
        // photo. `no-referrer` is already set app-wide by the response headers.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  )
}

/**
 * The same avatar inside an SVG, for the org chart.
 *
 * No error handling needed here: the circle is painted first and the image over
 * it, so a URL that 404s simply leaves the initials showing.
 */
export function SvgAvatar({
  name,
  photoUrl,
  x,
  y,
  size,
  clipId,
}: {
  name: string | null
  photoUrl?: string | null
  x: number
  y: number
  size: number
  /** Must be unique in the document — the calling id is. */
  clipId: string
}) {
  const src = safePhotoUrl(photoUrl)
  const r = size / 2

  return (
    <g transform={`translate(${x} ${y})`}>
      {src && (
        <clipPath id={clipId}>
          <circle cx={r} cy={r} r={r} />
        </clipPath>
      )}
      <circle cx={r} cy={r} r={r} fill={name ? avatarTint(name) : '#e5e5e5'} />
      <text
        x={r}
        y={r}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={Math.round(size * 0.4)}
        fontWeight={600}
        fill={name ? '#ffffff' : '#a3a3a3'}
      >
        {name ? initials(name) : '·'}
      </text>
      {src && (
        <image
          href={src}
          x={0}
          y={0}
          width={size}
          height={size}
          // Fill the circle rather than letter-boxing a portrait inside it.
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clipId})`}
        />
      )}
    </g>
  )
}
