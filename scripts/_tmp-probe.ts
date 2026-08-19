import { withClient } from './lib/pg'
import { run } from './lib/run'
import { signSession } from '../src/lib/auth-edge'
import { writeFileSync } from 'node:fs'

run(() =>
  withClient(async (c) => {
    const u = await c.query<{ id: string; name: string }>(
      `SELECT id, name FROM users WHERE is_admin AND is_active ORDER BY created_at LIMIT 1`,
    )
    if (u.rows.length === 0) throw new Error('no admin user')
    const token = await signSession({ sub: u.rows[0].id, name: u.rows[0].name })
    for (const path of ['/members', '/org-chart']) {
      const res = await fetch(`http://localhost:3001${path}`, {
        headers: { cookie: `ward_session=${token}` },
        redirect: 'manual',
      })
      const body = await res.text()
      console.log(path, res.status, 'bytes', body.length)
      writeFileSync(`/tmp/probe${path.replace(/\//g, '_')}.html`, body)
    }
  }),
)
