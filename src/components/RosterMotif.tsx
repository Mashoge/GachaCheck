// THM-6: a small original line motif per game for the Today "roster" cards.
// Decoration only: hidden from screen readers, drawn in the game's colour (--ga, set in index.css).
// No official logos, art or game fonts are used.

export function RosterMotif({ game }: { game: string | null }) {
  if (game === 'genshin') {
    // Astrolabe: two rings, tick marks and a four-point star
    const ticks = Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2
      const r1 = i % 6 === 0 ? 34 : 38
      return <line key={i} x1={50 + Math.cos(a) * r1} y1={50 + Math.sin(a) * r1} x2={50 + Math.cos(a) * 42} y2={50 + Math.sin(a) * 42} />
    })
    return (
      <svg viewBox="0 0 100 100" className="gc-roster-motif gc-spin" aria-hidden="true">
        <circle cx="50" cy="50" r="42" />
        <circle cx="50" cy="50" r="28" strokeDasharray="2 4" />
        {ticks}
        <path d="M50 30 L53 47 L70 50 L53 53 L50 70 L47 53 L30 50 L47 47 Z" />
      </svg>
    )
  }
  if (game === 'wuwa') {
    // Waveforms: three sine lines of different heights
    const wave = (amp: number, y: number, phase: number) => {
      let d = ''
      for (let x = 0; x <= 100; x += 2) {
        const v = y + Math.sin((x / 100) * Math.PI * 4 + phase) * amp
        d += `${x === 0 ? 'M' : 'L'}${x} ${v.toFixed(2)} `
      }
      return d
    }
    return (
      <svg viewBox="0 0 100 100" className="gc-roster-motif gc-drift" aria-hidden="true">
        <path d={wave(10, 38, 0)} />
        <path d={wave(6, 52, 1.2)} />
        <path d={wave(14, 66, 2.4)} strokeDasharray="1 3" />
      </svg>
    )
  }
  if (game === 'nte') {
    // Pixel blocks: a loose 6×6 grid, some cells filled
    const filled = new Set([1, 2, 7, 9, 14, 15, 16, 22, 27, 28, 33])
    return (
      <svg viewBox="0 0 100 100" className="gc-roster-motif" aria-hidden="true">
        {Array.from({ length: 36 }, (_, i) => {
          const x = 10 + (i % 6) * 14
          const y = 10 + Math.floor(i / 6) * 14
          return <rect key={i} x={x} y={y} width="11" height="11" className={filled.has(i) ? 'gc-pixel-on' : undefined} />
        })}
      </svg>
    )
  }
  return null
}
