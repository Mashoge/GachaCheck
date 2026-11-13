// Receives event data from the collector and saves it to the shared catalog.
//
//   POST /functions/v1/ingest          saves the run (all or nothing)
//   POST /functions/v1/ingest?dry=1    runs the same steps, then rolls them back; returns what would happen
//
// Every call needs the header  x-ingest-secret: <INGEST_SECRET>.
// This secret is separate from the reminder job's CRON_SECRET, so either can be replaced alone.
// The collector never gets a database key: it can only send records here to be checked.
// The writing itself happens in the database function public.catalog_ingest.
// The payload contract is in README.md next to this file.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { checkPayload, readBodyLimited, sameSecret } from '../_shared/ingest.ts'

const MAX_BODY_BYTES = 1_000_000

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS')
  const key = (keys ? JSON.parse(keys)['default'] : undefined) ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Supabase URL or server key is missing from the function environment')
  return createClient(url, key, { auth: { persistSession: false } })
}

Deno.serve(async (req) => {
  // Every reply and every log line carries this id, so a reply can be matched to the server log
  const requestId = crypto.randomUUID()
  const reply = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify({ ...body, request_id: requestId }, null, 2), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Request-Id': requestId },
    })

  if (req.method !== 'POST') return reply({ error: 'Use POST' }, 405)

  const secret = Deno.env.get('INGEST_SECRET')
  if (!secret) {
    console.error(`[${requestId}] INGEST_SECRET is not set`)
    return reply({ error: 'The ingest service is not configured' }, 500)
  }
  if (!sameSecret(req.headers.get('x-ingest-secret'), secret)) return reply({ error: 'Not allowed' }, 401)

  const dry = new URL(req.url).searchParams.get('dry') === '1'

  const read = await readBodyLimited(req, MAX_BODY_BYTES)
  if (!read.ok) return reply({ error: read.error }, read.status)

  let body: unknown
  try {
    body = JSON.parse(read.text)
  } catch {
    return reply({ error: 'Body is not valid JSON' }, 400)
  }

  // Problems with the caller's own data are returned in full: they say what to fix in the collector
  const check = checkPayload(body)
  if (!check.ok) return reply({ error: 'Payload rejected; nothing was saved', details: check.errors }, 400)

  try {
    const { data, error } = await adminClient().rpc('catalog_ingest', { p: check.payload, p_dry: dry })
    if (error) throw error
    const result = data as Record<string, unknown>
    console.log(`[${requestId}] ingest ${dry ? '(dry run) ' : ''}${check.payload.source}: ${JSON.stringify(result?.counts)}`)
    return reply(result)
  } catch (err) {
    // Database details stay in the server log; the caller gets the id to look them up
    console.error(`[${requestId}] ingest failed for ${check.payload.source}; nothing was saved:`, err)
    return reply({ error: 'Ingest failed; nothing was saved. Look up the request id in the function logs.' }, 500)
  }
})
