import { expect, mock, test } from 'claude-code/testing'

import { octCells } from '../hooks/octant'
import { octDots } from '../hooks/octant_art'
import { sitDots } from '../hooks/sit_art'
import { advance, cells, PALETTE, DONE_TICKS, dots, frameAt, picture, SLEEP_TICKS, STEP, TICK_MS, wanted } from '../hooks/art'

type StageOn = Parameters<Parameters<typeof test>[1]>[1]

const RUN = { origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 120 } } as const
const START = { cwd: '/work', surface: null, isInteractive: true }
const TURN = { answer: 'ok', turnId: 't1', durationMs: 1, isAborted: false, reason: 'answer' } as const
const BAND = {
  plugin: 'dotpet',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

type Blit = { key: string; cells: string }

const ENGINE = { type: 'engine', ref: 0 } as const
const CANDIDATES = { type: 'Text', children: ['1:今日は'] } as const

// drawsBelow = 下の MOD が帯を描いているか。描いていなければ本体自身の描画（何も出さない）を返す
function stage(on: StageOn, stored: Record<string, unknown>, blits: Blit[], drawsBelow: () => boolean = () => false) {
  const clock = mock.clock(on, { now: 1000 })
  on('ui.render', () => (drawsBelow() ? CANDIDATES : ENGINE))
  on('store.get', ($, e) => ({ value: stored[e.key] }))
  on('store.set', ($, e) => {
    stored[e.key] = e.value

    return { value: undefined }
  })
  on('ui.blit', ($, e) => {
    blits.push({ key: e.key, cells: 'cells' in e ? e.cells : '' })

    return { value: {} }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  return clock
}


test('大の全72コマは10行×20文字でパレットの文字か空白', () => {
  let frames = 0
  for (const [mode, count] of [['idle', 8], ['work', 48], ['done', 8], ['sleep', 8]] as const) {
    for (let frame = 0; frame < count; frame++) {
      const rows = dots(mode, frame)
      expect(rows.length).toBe(10)
      expect(rows.every(row => row.length === 20 && [...row].every(k => k === ' ' || k in PALETTE))).toBe(true)
      frames++
    }
  }
  expect(frames).toBe(72)
})

test('大のコマは生成した絵を返し、戻り値の配列を変更しても元の絵を変えない', () => {
  for (const mode of ['idle', 'work', 'done', 'sleep'] as const) {
    const count = mode === 'work' ? 48 : 8
    for (let frame = 0; frame < count; frame++) {
      expect(dots(mode, frame)).toEqual(sitDots(mode, frame))
      expect(dots(mode, frame + count)).toEqual(dots(mode, frame))
    }
  }
  const copy = dots('idle', 0)
  copy[0] = ''
  expect(dots('idle', 0)).toEqual(sitDots('idle', 0))
})

test('cells は 20×5 文字ぶんの u32 を 3 つずつ並べた base64', () => {
  // 変換の決まりを手作りの絵で確認する（編集する正本の絵に依存しない）
  const rows = [' AM A'.padEnd(20), 'AAE S'.padEnd(20), ...Array(8).fill(' '.repeat(20))]
  const bytes = Uint8Array.from(atob(cells(rows)), c => c.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  const cell = (x: number): number[] => Array.from(words.slice(x * 3, x * 3 + 3))
  expect(words.length).toBe(20 * 5 * 3)
  expect(cell(0)).toEqual([0x2584, PALETTE.A, 0x01000000])
  expect(cell(1)).toEqual([0x2580, PALETTE.A, PALETTE.A])
  expect(cell(2)).toEqual([0x2580, PALETTE.M, PALETTE.E])
  expect(cell(3)).toEqual([0x20, 0x01000000, 0x01000000])
  expect(cell(4)).toEqual([0x2580, PALETTE.A, PALETTE.S])
})

test('コマ送り: 待機は 10・完了は 12・おやすみは 13 歩（1 歩 = 3 刻み）で 1 周、完了は待機へ戻り、待機が続くと眠る', () => {
  expect(TICK_MS * STEP).toBe(330)
  expect([0, 1, 2, 3, 8, 9, 10].map(step => frameAt('idle', step * STEP))).toEqual([0, 0, 0, 1, 6, 7, 0])
  expect([0, 2, 3, 8, 9].map(tick => frameAt('idle', tick))).toEqual([0, 0, 0, 0, 1])
  // 作業中は 1 コマ 1 刻み（110 ミリ秒）で、48 刻みで 1 周する
  expect([0, 1, 5, 17, 47, 48].map(tick => frameAt('work', tick))).toEqual([0, 1, 5, 17, 47, 0])
  expect(dots('work', 48)).toEqual(dots('work', 0))
  expect(Array.from({ length: 13 }, (_, step) => frameAt('done', step * STEP))).toEqual([0, 0, 0, 0, 1, 2, 3, 4, 4, 5, 6, 7, 0])
  expect(Array.from({ length: 14 }, (_, step) => frameAt('sleep', step * STEP))).toEqual([0, 0, 0, 1, 2, 2, 3, 4, 4, 5, 6, 6, 7, 0])
  expect(DONE_TICKS).toBe(24 * STEP)
  expect(advance({ mode: 'done', tick: DONE_TICKS - 2 })).toEqual({ mode: 'done', tick: DONE_TICKS - 1 })
  expect(advance({ mode: 'done', tick: DONE_TICKS - 1 })).toEqual({ mode: 'idle', tick: 0 })
  expect(advance({ mode: 'idle', tick: SLEEP_TICKS - 1 })).toEqual({ mode: 'sleep', tick: 0 })
  expect(advance({ mode: 'work', tick: 5000 })).toEqual({ mode: 'work', tick: 5001 })
})

test('/dotpet の引数を読む', () => {
  expect(wanted('', true)).toEqual({ isOn: false })
  expect(wanted('', false)).toEqual({ isOn: true })
  expect(wanted(' ON ', false)).toEqual({ isOn: true })
  expect(wanted('オフ', true)).toEqual({ isOn: false })
  expect(wanted('small', false)).toEqual({ isOn: true, size: 'small' })
  expect(wanted('大', true)).toEqual({ isOn: true, size: 'big' })
  expect(wanted('image', false)).toEqual({ isOn: true, size: 'image' })
  expect(wanted('画像', true)).toEqual({ isOn: true, size: 'image' })
  expect(wanted('still', false)).toEqual({ isOn: true, size: 'still' })
  expect(wanted('静止画', true)).toEqual({ isOn: true, size: 'still' })
  expect(wanted('oct', false)).toEqual({ isOn: true, size: 'small' })
  expect(wanted('オクタント', true)).toEqual({ isOn: true, size: 'small' })
  expect(wanted('にして', true)).toBe(null)
})

test('/dotpet small はオクタントの全身を Text の 10 文字 × 3 行で出し、絵が変わると帯を描き直す', async ($, on) => {
  const blits: Blit[] = []
  const stored: Record<string, unknown> = {}
  const clock = stage(on, stored, blits)
  type Line = { type: string; children: { props?: { color?: string; backgroundColor?: string }; children: string[] }[] }
  const shown = async (ui: { drawn(): Promise<unknown> }) => {
    const tree = (await ui.drawn()) as { type: string; children: Line[] }
    expect(tree.type).toBe('Box')

    return tree.children.map(line => line.children.map(cell => ({ char: cell.children[0], color: cell.props?.color, background: cell.props?.backgroundColor })))
  }
  const want = (rows: readonly string[]) => octCells(rows).map(line => line.map(cell => ({ char: cell.char, color: cell.color, background: cell.background })))

  await $.session.start(START)
  expect(await $.command.run({ ...RUN, command: 'dotpet', args: 'small' })).toEqual({ text: 'トカゲ: ON（オクタント・入力欄の上に出ます）' })
  expect(stored).toEqual({ size: 'small', isOn: true })

  const ui = await $.ui.mount(BAND)
  expect(await shown(ui)).toEqual(want(octDots('idle', 0)))

  // 待機の4歩目で選ばれるコマを確認する
  await clock.advance(TICK_MS * STEP * 4)
  expect(await shown(ui)).toEqual(want(octDots('idle', 2)))

  await $.turn.start({ text: 'やって', turnId: 't1' })
  expect(await shown(ui)).toEqual(want(octDots('work', 0)))
  await clock.advance(TICK_MS)
  expect(await shown(ui)).toEqual(want(octDots('work', 1)))

  await $.turn.complete(TURN)
  expect(await shown(ui)).toEqual(want(octDots('done', 0)))
  // Text の絵は blit を使わない
  expect(blits).toEqual([])
  await ui.unmount()
})

test('帯に20×5のRasterを描き、時計で絵が変わったときだけ描き替える', async ($, on) => {
  const blits: Blit[] = []
  const clock = stage(on, {}, blits)
  await $.session.start(START)
  const ui = await $.ui.mount(BAND)
  expect(await ui.drawn()).toMatchObject({ type: 'Raster', props: { key: 'dotpet', columns: 20, rows: 5, cells: cells(dots('idle', 0)) } })
  const expected: Blit[] = []
  let shown = cells(dots('idle', 0))
  for (let tick = 1; tick <= STEP * 4; tick++) {
    const next = cells(dots('idle', frameAt('idle', tick)))
    if (shown !== next) expected.push({ key: 'dotpet', cells: next })
    shown = next
    await clock.advance(TICK_MS)
  }
  expect(blits).toEqual(expected)
  await ui.unmount()
})

test('ターンの開始で作業中、完了で完了の絵にする（サブエージェントの完了では変えない）', async ($, on) => {
  const blits: Blit[] = []
  stage(on, {}, blits)

  await $.session.start(START)
  const ui = await $.ui.mount(BAND)
  await $.turn.start({ text: 'やって', turnId: 't1' })
  expect(blits).toEqual(cells(dots('idle', 0)) === cells(dots('work', 0)) ? [] : [{ key: 'dotpet', cells: cells(dots('work', 0)) }])

  const before = blits.length
  await $.turn.complete({ ...TURN, agentId: 'worker' })
  expect(blits.length).toBe(before)
  await $.turn.complete(TURN)
  expect(blits.length).toBe(before + (cells(dots('work', 0)) === cells(dots('done', 0)) ? 0 : 1))
  if (blits.length > before) expect(blits.at(-1)).toEqual({ key: 'dotpet', cells: cells(dots('done', 0)) })
  await ui.unmount()
})

test('下の MOD が帯を描くあいだはそちらを出し、描かなくなったらトカゲに戻る', async ($, on) => {
  const blits: Blit[] = []
  let isConverting = true
  const clock = stage(on, {}, blits, () => isConverting)

  await $.session.start(START)
  const ui = await $.ui.mount(BAND)
  expect(await ui.drawn()).toMatchObject(CANDIDATES)
  // 譲っているあいだは時計を回さず、描き替えも送らない
  await clock.advance(TICK_MS * 12)
  expect(blits).toEqual([])
  await ui.unmount()

  isConverting = false
  const back = await $.ui.mount(BAND)
  expect(await back.drawn()).toMatchObject({ type: 'Raster', props: { key: 'dotpet', columns: 20, rows: 5 } })
  await back.unmount()
})

test('picture は 1 ドットを 4×4 ピクセルの RGBA にし、色の無いドットは透明にする', () => {
  const made = picture([' AME'.padEnd(20), ...Array(9).fill(' '.repeat(20))])
  const bytes = Uint8Array.from(atob(made.rgba), c => c.charCodeAt(0))
  const pixel = (x: number, y: number): number[] => Array.from(bytes.slice((y * made.width + x) * 4, (y * made.width + x) * 4 + 4))
  const rgba = (key: string) => [(PALETTE[key]! >> 16) & 255, (PALETTE[key]! >> 8) & 255, PALETTE[key]! & 255, 255]
  expect([made.width, made.height, bytes.length]).toEqual([80, 40, 80 * 40 * 4])
  expect(pixel(0, 0)).toEqual([0, 0, 0, 0])
  expect(pixel(4, 0)).toEqual(rgba('A'))
  expect(pixel(7, 3)).toEqual(rgba('A'))
  expect(pixel(8, 0)).toEqual(rgba('M'))
  expect(pixel(12, 0)).toEqual(rgba('E'))
})

test('/dotpet image は絵を Image で出し、作業中も 12×3 文字の箱のまま', async ($, on) => {
  const blits: Blit[] = []
  const stored: Record<string, unknown> = {}
  stage(on, stored, blits)

  await $.session.start(START)
  expect(await $.command.run({ ...RUN, command: 'dotpet', args: 'image' })).toEqual({ text: 'トカゲ: ON（画像・入力欄の上に出ます）' })
  expect(stored).toEqual({ size: 'image', isOn: true })

  const ui = await $.ui.mount(BAND)
  expect(await ui.drawn()).toMatchObject({ type: 'Image', props: { key: 'dotpet', columns: 12, rows: 3, source: picture(dots('idle', 0)) } })

  await $.turn.start({ text: 'やって', turnId: 't1' })
  expect(await ui.drawn()).toMatchObject({ type: 'Image', props: { columns: 12, rows: 3 } })
  expect(blits.length).toBe(picture(dots('idle', 0)).rgba === picture(dots('work', 0)).rgba ? 0 : 1)

  await $.turn.complete(TURN)
  expect(await ui.drawn()).toMatchObject({ type: 'Image', props: { columns: 12, rows: 3 } })
  expect(blits.length).toBe((picture(dots('idle', 0)).rgba === picture(dots('work', 0)).rgba ? 0 : 1) + (picture(dots('work', 0)).rgba === picture(dots('done', 0)).rgba ? 0 : 1))
  // 画像のときの描き替えは cells ではなく source で送る
  expect(blits.every(b => b.key === 'dotpet' && b.cells === '')).toBe(true)
  await ui.unmount()
})

test('/dotpet still は待機の絵を Image で 1 枚だけ出し、作業中も時計でも描き替えない', async ($, on) => {
  const blits: Blit[] = []
  const stored: Record<string, unknown> = {}
  const clock = stage(on, stored, blits)

  await $.session.start(START)
  expect(await $.command.run({ ...RUN, command: 'dotpet', args: 'still' })).toEqual({ text: 'トカゲ: ON（静止画・入力欄の上に出ます）' })
  expect(stored).toEqual({ size: 'still', isOn: true })

  const ui = await $.ui.mount(BAND)
  const still = { type: 'Image', props: { key: 'dotpet', columns: 12, rows: 3, source: picture(dots('idle', 0)) } }
  expect(await ui.drawn()).toMatchObject(still)

  await $.turn.start({ text: 'やって', turnId: 't1' })
  await clock.advance(TICK_MS * 12)
  expect(await ui.drawn()).toMatchObject(still)

  await $.turn.complete(TURN)
  await clock.advance(TICK_MS * 12)
  expect(await ui.drawn()).toMatchObject(still)
  expect(blits).toEqual([])
  await ui.unmount()
})

test('/dotpet off は保存され、分からない語では変えない', async ($, on) => {
  const stored: Record<string, unknown> = {}
  stage(on, stored, [])

  await $.session.start(START)
  expect(await $.command.run({ ...RUN, command: 'dotpet', args: 'off' })).toEqual({ text: 'トカゲ: OFF' })
  expect(stored).toEqual({ isOn: false })
  expect(await $.command.run({ ...RUN, command: 'dotpet', args: 'なに' })).toEqual({
    text: '使い方: /dotpet（切り替え）・/dotpet on・/dotpet off・/dotpet big（全身）・/dotpet small（オクタントで小さい全身）・/dotpet image（画像で小さく・試験中）・/dotpet still（画像 1 枚・動かない）',
  })
  expect(stored).toEqual({ isOn: false })
  expect(await $.command.run({ ...RUN, command: 'dotpet', args: '' })).toEqual({ text: 'トカゲ: ON（全身・入力欄の上に出ます）' })
  expect(stored).toEqual({ isOn: true })
})

test('小の全72コマは12行×20文字でパレットの文字か空白、各マスは2色以内', () => {
  let frames = 0
  for (const [mode, count] of [['idle', 8], ['work', 48], ['done', 8], ['sleep', 8]] as const) {
    for (let frame = 0; frame < count; frame++) {
      const rows = octDots(mode, frame)
      expect(rows.length).toBe(12)
      expect(rows.every(row => row.length === 20 && [...row].every(k => k === ' ' || k in PALETTE))).toBe(true)
      for (let y = 0; y < 12; y += 4) for (let x = 0; x < 20; x += 2) {
        expect(new Set([0,1,2,3].flatMap(dy => [rows[y+dy]![x], rows[y+dy]![x+1]])).size).toBeLessThanOrEqual(2)
      }
      expect(octCells(rows).map(line => line.length)).toEqual([10,10,10])
      frames++
    }
  }
  expect(frames).toBe(72)
})

test('octCellsは手作りの透明＋1色・2色・1色のマスをビット順に変換する', () => {
  const hex = (k: string) => '#' + PALETTE[k]!.toString(16).padStart(6, '0')
  // Aはビット0のみ → GLYPHS[1] = U+1CEA8、地色なし
  expect(octCells(['A ', '  ', '  ', '  '])).toEqual([[{ char: '\u{1CEA8}', color: hex('A'), background: undefined }]])
  // 最初のMが地色、Aはビット4〜7 → 0xf0、GLYPHS[240] = U+2584
  expect(octCells(['MM', 'MM', 'AA', 'AA'])).toEqual([[{ char: '▄', color: hex('A'), background: hex('M') }]])
  // 地色と文字色が同じ → ビット0、GLYPHS[0] = U+0020
  expect(octCells(['AA', 'AA', 'AA', 'AA'])).toEqual([[{ char: ' ', color: hex('A'), background: hex('A') }]])
})
