// 入力欄の上に出すドット絵のペット（大は20×10ドット）。
// 絵と色の正本は art/dotpet_art.json。生成した sit_art.ts と palette.ts を読む。

import { sitDots } from './sit_art'
import { PALETTE } from './palette'
export { PALETTE } from './palette'

export type Mode = 'idle' | 'work' | 'done' | 'sleep'

// 大 = おすわりの全身（20 文字 × 5 行）、小 = オクタント用に描かれた全身をオクタントの文字で出す（10 文字 × 3 行・絵は octant_art.ts、出し方は octant.ts）、
// 画像 = 全身の絵を画像として出し、端末に縮めてもらう（12 文字 × 3 行。画像を出せる端末だけ・試験中）
// 静止画 = 画像と同じ箱に、おすわりの絵を 1 枚だけ出す。描き替えを送らない（描き替えで絵が崩れる端末用）
export type Size = 'big' | 'small' | 'image' | 'still'
export const BOX: Record<Size, { columns: number; rows: number }> = {
  big: { columns: 20, rows: 5 },
  small: { columns: 10, rows: 3 },
  image: { columns: 12, rows: 3 },
  still: { columns: 12, rows: 3 },
}
const DEFAULT_COLOR = 0x01000000 // 端末の既定色（Raster の決まり）
const UPPER = 0x2580 // ▀
const LOWER = 0x2584 // ▄
const SPACE = 0x20

// 大・画像・静止画は同じ20×10ドット。小は octant_art.ts。
export function dots(mode: Mode, frame: number): string[] {
  return [...sitDots(mode, frame)]
}

export const WORK_CYCLE = 48

// 1 文字 = 上下 2 ドット。Raster の cells（[文字, 文字色, 背景色] の u32 を並べた base64）にする
export function cells(rows: readonly string[]): string {
  const columns = rows[0]!.length
  const height = rows.length / 2
  const words = new Uint32Array(columns * height * 3)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < columns; x++) {
      const top = PALETTE[rows[y * 2]![x]!]
      const bottom = PALETTE[rows[y * 2 + 1]![x]!]
      const at = (y * columns + x) * 3
      words[at] = top !== undefined ? UPPER : bottom !== undefined ? LOWER : SPACE
      words[at + 1] = top ?? bottom ?? DEFAULT_COLOR
      words[at + 2] = top !== undefined && bottom !== undefined ? bottom : DEFAULT_COLOR
    }
  }

  return (new Uint8Array(words.buffer) as unknown as { toBase64(): string }).toBase64()
}

// 1 ドットを 4×4 ピクセルにする。端末が縮めるときにドットの角がぼけにくい
const PIXELS_PER_DOT = 4

export type Picture = { rgba: string; width: number; height: number }

// Image の source（RGBA）にする。色の無いドットは透明
export function picture(rows: readonly string[]): Picture {
  const width = rows[0]!.length * PIXELS_PER_DOT
  const height = rows.length * PIXELS_PER_DOT
  const bytes = new Uint8Array(width * height * 4)

  for (let y = 0; y < height; y++) {
    const row = rows[Math.floor(y / PIXELS_PER_DOT)]!

    for (let x = 0; x < width; x++) {
      const color = PALETTE[row[Math.floor(x / PIXELS_PER_DOT)]!]

      if (color !== undefined) {
        const at = (y * width + x) * 4
        bytes[at] = (color >> 16) & 0xff
        bytes[at + 1] = (color >> 8) & 0xff
        bytes[at + 2] = color & 0xff
        bytes[at + 3] = 0xff
      }
    }
  }

  return { rgba: (bytes as unknown as { toBase64(): string }).toBase64(), width, height }
}

// 時計の 1 刻み = 330 ミリ秒
// 時計の 1 刻み = 110 ミリ秒。作業中の打鍵を速く見せるための細かさで、ほかの状態は 3 刻み（330 ミリ秒）を 1 歩にする
export const TICK_MS = 110
export const STEP = 3
export const DONE_TICKS = 24 * STEP // 完了の絵は 2 周・約 8 秒
export const SLEEP_TICKS = 900 * STEP // 待機が約 5 分続いたら眠る

// 待機は 10 歩で 1 周: 最初のコマを 3 歩見せ、あとは 1 歩ずつ（6 コマ目がまばたき）
export function frameAt(mode: Mode, tick: number): number {
  // 作業中は 1 コマ 1 刻み（4 コマの 1 往復が 440 ミリ秒。元の HTML の 560 ミリ秒より少し速い）
  if (mode === 'work') {
    return tick % WORK_CYCLE
  }

  const step = Math.floor(tick / STEP)

  if (mode === 'idle') {
    return Math.max(0, (step % 10) - 2)
  }

  // 完了は 12 歩、おやすみは 13 歩で 8 コマを 1 周する
  const frames = mode === 'done'
    ? [0, 0, 0, 0, 1, 2, 3, 4, 4, 5, 6, 7]
    : [0, 0, 0, 1, 2, 2, 3, 4, 4, 5, 6, 6, 7]

  return frames[step % frames.length]!
}

export type Pet = { mode: Mode; tick: number }

// 1 刻み進める。完了は少し見せたら待機へ、待機が長く続いたら眠る
export function advance(pet: Pet): Pet {
  const tick = pet.tick + 1

  if (pet.mode === 'done' && tick >= DONE_TICKS) {
    return { mode: 'idle', tick: 0 }
  }

  if (pet.mode === 'idle' && tick >= SLEEP_TICKS) {
    return { mode: 'sleep', tick: 0 }
  }

  return { mode: pet.mode, tick }
}

export type Wanted = { isOn: boolean; size?: Size }

// `/dotpet` の引数。空は今の逆へ切り替える。大きさを言えば出したうえでその大きさにする。分からない語は null
export function wanted(args: string, isOn: boolean): Wanted | null {
  const word = args.trim().toLowerCase()

  if (word === '') {
    return { isOn: !isOn }
  }

  if (word === 'on' || word === 'オン') {
    return { isOn: true }
  }

  if (word === 'off' || word === 'オフ') {
    return { isOn: false }
  }

  if (word === 'big' || word === '大') {
    return { isOn: true, size: 'big' }
  }

  if (word === 'small' || word === '小' || word === 'oct' || word === 'オクタント') {
    return { isOn: true, size: 'small' }
  }

  if (word === 'image' || word === '画像') {
    return { isOn: true, size: 'image' }
  }

  if (word === 'still' || word === '静止画') {
    return { isOn: true, size: 'still' }
  }

  return null
}
