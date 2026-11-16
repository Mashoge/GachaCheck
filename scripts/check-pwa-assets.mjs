import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const manifest = JSON.parse(await readFile(resolve('public/manifest.webmanifest'), 'utf8'))

assert.equal(manifest.id, '/', 'Manifest id must remain stable at the app root')
assert.equal(manifest.start_url, '/', 'PWA must launch at the app root')
assert.equal(manifest.scope, '/', 'PWA scope must include all app routes')
assert.equal(manifest.display, 'standalone', 'Installed app must open without browser chrome')
assert.ok(manifest.name && manifest.short_name, 'Manifest must provide app names')
assert.ok(manifest.theme_color && manifest.background_color, 'Manifest must provide launch colors')
assert.ok(Array.isArray(manifest.icons), 'Manifest must list launcher icons')

const iconSizes = new Set()
let hasMaskable = false
for (const icon of manifest.icons) {
  assert.equal(icon.type, 'image/png', `Expected PNG icon: ${icon.src}`)
  assert.ok(icon.src.startsWith('/icons/'), `Icon must be hosted under /icons: ${icon.src}`)
  const bytes = await readFile(resolve('public', icon.src.slice(1)))
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), `Invalid PNG: ${icon.src}`)
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  assert.equal(icon.sizes, `${width}x${height}`, `Icon size metadata does not match ${icon.src}`)
  iconSizes.add(icon.sizes)
  if ((icon.purpose ?? 'any').split(/\s+/).includes('maskable')) hasMaskable = true
}

assert.ok(iconSizes.has('192x192'), 'Manifest must include a 192px icon')
assert.ok(iconSizes.has('512x512'), 'Manifest must include a 512px icon')
assert.ok(hasMaskable, 'Manifest must include a maskable icon')

const html = await readFile(resolve('index.html'), 'utf8')
assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/, 'index.html must link the manifest')
assert.match(html, /apple-touch-icon/, 'index.html must include an Apple touch icon')
const appleTouchIcon = await readFile(resolve('public/icons/apple-touch-icon.png'))
assert.deepEqual(appleTouchIcon.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'Apple touch icon must be PNG')
assert.equal(appleTouchIcon.readUInt32BE(16), 180, 'Apple touch icon must be 180px wide')
assert.equal(appleTouchIcon.readUInt32BE(20), 180, 'Apple touch icon must be 180px high')

console.log('PWA asset check passed: manifest, stable identity, standalone display, and launcher icons.')
