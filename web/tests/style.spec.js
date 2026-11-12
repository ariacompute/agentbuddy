import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Monochrome guard, mirroring agenthub: the UI must live on the black→white
// luminance axis only. Any literal colour with a hue fails the build.
const ROOT = join(__dirname, '..', 'src')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else if (/\.(css|vue|js)$/.test(entry)) out.push(full)
  }
  return out
}

const FILES = walk(ROOT)

function text() {
  return FILES.map((f) => readFileSync(f, 'utf8')).join('\n')
}

// Colour words with a hue. Neutral greys are intentionally allowed.
const HUE_WORDS = [
  'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'cyan',
  'magenta', 'brown', 'lime', 'teal', 'navy', 'maroon', 'olive', 'violet',
  'indigo', 'aqua', 'fuchsia', 'crimson', 'gold', 'salmon', 'khaki', 'coral',
]

describe('monochrome style guard', () => {
  const src = text()

  it('has no hue colour words', () => {
    const found = []
    for (const word of HUE_WORDS) {
      // Exclude matches glued to a hyphen (e.g. `input-required`, a protocol
      // state, not a colour) or to other word chars in any language
      // (e.g. French `redémarrage`). Unicode-aware `\p{L}` covers accented
      // and non-Latin letters; a hue word used as a colour stands alone.
      const re = new RegExp(`(^|[^\\p{L}\\p{N}_-])${word}(?![\\p{L}\\p{N}_-])`, 'iu')
      if (re.test(src)) found.push(word)
    }
    expect(found, `hue words present: ${found.join(', ')}`).toEqual([])
  })

  it('hex colours are neutral (R==G==B)', () => {
    const re = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g
    let m
    while ((m = re.exec(src))) {
      const hex = m[1]
      const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
      const r = parseInt(full.slice(0, 2), 16)
      const g = parseInt(full.slice(2, 4), 16)
      const b = parseInt(full.slice(4, 6), 16)
      expect(r === g && g === b, `non-neutral hex #${hex}`).toBe(true)
    }
  })

  it('rgb/rgba are neutral', () => {
    const re = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g
    let m
    while ((m = re.exec(src))) {
      expect(Number(m[1]) === Number(m[2]) && Number(m[2]) === Number(m[3]),
        `non-neutral rgb ${m[0]}`).toBe(true)
    }
  })

  it('hsl is desaturated (saturation 0)', () => {
    // matches hsl(210 24% 15%) and hsl(210, 24%, 15%)
    const re = /hsl\(\s*(\d+)\s*[, ]\s*(\d+)%/g
    let m
    while ((m = re.exec(src))) {
      expect(Number(m[2]), `hsl with saturation ${m[0]}`).toBe(0)
    }
  })
})

// Regression guard: Action / Arguments / Run used to sit in a plain `.row`.
// The inputs kept their intrinsic ~177px each, so the row ran outside the
// ~300px `.grid-2` card and squeezed the Run button. jsdom has no layout, so
// pin the CSS contract and the class that wires it to the component.
describe('connector action form layout', () => {
  const css = readFileSync(join(ROOT, 'style.css'), 'utf8')
  const card = readFileSync(join(ROOT, 'components', 'ConnectorCard.vue'), 'utf8')

  const declarations = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || ''
  }

  it('wraps the controls and lets inputs shrink below their intrinsic width', () => {
    expect(declarations('.connector-actions')).toMatch(/flex-wrap:\s*wrap/)
    const inputs = declarations('.connector-actions > input')
    expect(inputs).toMatch(/flex:\s*1 1\s+110px/)
    expect(inputs).toMatch(/min-width:\s*0/)
    expect(declarations('.connector-actions > .btn')).toMatch(/flex:\s*none/)
  })

  it('uses the wrapping container and design-system text inputs', () => {
    expect(card).toContain('class="connector-actions"')
    expect(card.match(/<input[^>]*type="text"/g)).toHaveLength(2)
  })
})

// The desktop E2E suite measures real bounding boxes on the settings screen;
// jsdom has no layout engine, so pin the declarations that keep every button
// and select at the 44px touch-target floor.
describe('touch-target floor', () => {
  const css = readFileSync(join(ROOT, 'style.css'), 'utf8')
  const switcher = readFileSync(join(ROOT, 'components', 'LanguageSwitcher.vue'), 'utf8')
  const declarations = (source, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return source.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] || ''
  }

  it('gives .btn, .btn-sm and select the full touch-min height', () => {
    for (const selector of ['.btn', '.btn-sm', 'select']) {
      expect(declarations(css, selector), `${selector} min-height`).toMatch(/min-height:\s*var\(--touch-min\)/)
    }
  })

  it('does not shrink the topbar language switcher below touch-min', () => {
    expect(declarations(switcher, '.lang-select')).toMatch(/min-height:\s*var\(--touch-min\)/)
  })
})
