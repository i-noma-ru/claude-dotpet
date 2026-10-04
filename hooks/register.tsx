import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import {
  advance,
  BOX,
  cells,
  dots,
  frameAt,
  picture,
  TICK_MS,
  wanted,
  type Mode,
  type Pet,
  type Size,
} from './art'
import { octCells } from './octant'
import { octDots } from './octant_art'

const isOn = atom({ plugin: 'dotpet', key: 'isOn' } as const, true)
const size = atom({ plugin: 'dotpet', key: 'size' } as const, 'big')
// オクタントの絵は Text で描くので blit で描き替えられない。絵が変わるたびに数を進めて、帯を描き直させる
const redraw = atom({ plugin: 'dotpet', key: 'redraw' } as const, 0)
const RASTER = 'dotpet'
const STORE_ON = 'isOn'
const STORE_SIZE = 'size'
const USAGE = '使い方: /dotpet（切り替え）・/dotpet on・/dotpet off・/dotpet big（全身）・/dotpet small（オクタントで小さい全身）・/dotpet image（画像で小さく・試験中）・/dotpet still（画像 1 枚・動かない）'
const LABEL: Record<Size, string> = { big: '全身', small: 'オクタント', image: '画像', still: '静止画' }

// 絵の状態。再読み込みで待機に戻ってよいので $.state には置かない（ON/OFF と大きさだけ $.state と $.store に置く）
type Stage = { pet: Pet; size: Size; band: string | undefined; shown: string; timer: Timer | undefined }

// 静止画で出す 1 枚（待機のおすわり）
const STILL = picture(dots('idle', 0))

// 画像を出せない端末で、絵の代わりに出る文
const ALT = 'トカゲ（この端末は画像を出せません。/dotpet big で文字の絵に戻ります）'

function drawn(stage: Stage): string[] {
  const at = frameAt(stage.pet.mode, stage.pet.tick)

  // 小はオクタント用に描かれた別の絵（20×12 ドット）
  if (stage.size === 'small') {
    return [...octDots(stage.pet.mode, at)]
  }

  return dots(stage.pet.mode, at)
}

function frame(stage: Stage): string {
  return cells(drawn(stage))
}

// $ を受け取る関数はモジュール先頭で宣言する。
// 絵が変わったときだけ描き替える。帯が畳まれているあいだの拒否は放っておく
function paint($: EngineInterface, stage: Stage): void {
  // 静止画は帯を描いたときの 1 枚だけで、描き替えを送らない
  if (stage.band === undefined || stage.size === 'still') {
    return
  }

  if (stage.size === 'small') {
    const next = drawn(stage).join('\n')

    if (next === stage.shown) {
      return
    }

    stage.shown = next
    void update($, redraw, n => n + 1).catch(() => undefined)

    return
  }

  if (stage.size === 'image') {
    const source = picture(drawn(stage))

    if (source.rgba === stage.shown) {
      return
    }

    stage.shown = source.rgba
    void $.ui.blit({ requestId: stage.band, key: RASTER, source }).catch(() => undefined)

    return
  }

  const next = frame(stage)

  if (next === stage.shown) {
    return
  }

  stage.shown = next
  void $.ui.blit({ requestId: stage.band, key: RASTER, cells: next }).catch(() => undefined)
}

function setMode($: EngineInterface, stage: Stage, mode: Mode): void {
  stage.pet = { mode, tick: 0 }
  paint($, stage)
}

function tick($: EngineInterface, stage: Stage): void {
  stage.pet = advance(stage.pet)
  paint($, stage)
}

function stop(stage: Stage): void {
  stage.timer?.cancel()
  stage.timer = undefined
  stage.band = undefined
  stage.shown = ''
}

export const register: Register = on => {
  const stage: Stage = { pet: { mode: 'idle', tick: 0 }, size: 'big', band: undefined, shown: '', timer: undefined }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'dotpet', description: 'トカゲ（入力欄の上のドット絵のペット）を出す・消す・大きさを変える: /dotpet [on|off|big|small|image|still]' })

    if ((await $.store.get(STORE_ON)) === false) {
      await update($, isOn, () => false)
    }

    const stored = await $.store.get(STORE_SIZE)

    if (stored === 'small' || stored === 'image' || stored === 'still') {
      await update($, size, () => stored)
    }

    // 以前の呼び名 oct で保存されていたら、小として読む
    if (stored === 'oct') {
      await update($, size, () => 'small')
    }

    return next(e)
  })

  on('command.run', { command: 'dotpet' }, async ($, e) => {
    const want = wanted(e.args, await read($, isOn))

    if (want === null) {
      return { text: USAGE }
    }

    const chosen = want.size

    if (chosen !== undefined) {
      await update($, size, () => chosen)
      await $.store.set(STORE_SIZE, chosen)
    }

    await update($, isOn, () => want.isOn)
    await $.store.set(STORE_ON, want.isOn)

    if (!want.isOn) {
      return { text: 'トカゲ: OFF' }
    }

    return { text: `トカゲ: ON（${LABEL[await read($, size)]}・入力欄の上に出ます）` }
  })

  // turn.start の入力に agentId は無い（text と turnId だけ）ので、ここでは主担当かどうかを見分けない
  on('turn.start', ($, e, next) => {
    setMode($, stage, 'work')

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)

    if (e.agentId === undefined) {
      setMode($, stage, 'done')
    }

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Raster は端末だけの部品
    if (e.surface !== 'terminal') {
      return next(e)
    }

    // 下の MOD が帯を描くとき（vime の変換候補など）は、そちらに譲る。
    // dotpet は名前順で先に読み込まれるので、譲らないと下の帯が出ない
    const below = await next(e)

    if (below.type !== 'engine') {
      stop(stage)

      return below
    }

    stage.size = await read($, size)

    // 静止画は帯を描いたときの 1 枚だけを出し、時計も回さない
    if (stage.size === 'still') {
      if (!(await read($, isOn)) || e.props.hasSurvey || e.props.maxRows < BOX.still.rows) {
        stop(stage)

        return below
      }

      stage.timer?.cancel()
      stage.timer = undefined
      stage.band = e.requestId

      const { Image: Still } = $.ui.resolve(e)

      return <Still key={RASTER} source={STILL} columns={BOX.still.columns} rows={BOX.still.rows} alt={ALT} />
    }

    // オクタントは Raster で出せない文字（BMP の外）なので、色つきの Text を 1 マスずつ並べる
    if (stage.size === 'small') {
      if (!(await read($, isOn)) || e.props.hasSurvey || e.props.maxRows < BOX.small.rows) {
        stop(stage)

        return below
      }

      // 絵が変わると paint がこの数を進めるので、読んでおくと帯が描き直される
      await read($, redraw)
      stage.band = e.requestId
      stage.timer ??= $.clock.every(TICK_MS, () => tick($, stage))

      const rows = drawn(stage)
      stage.shown = rows.join('\n')

      const { Box, Text } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          {octCells(rows).map(line => (
            <Text>
              {line.map(cell => (
                <Text color={cell.color} backgroundColor={cell.background}>
                  {cell.char}
                </Text>
              ))}
            </Text>
          ))}
        </Box>
      )
    }

    const isImage = stage.size === 'image'
    const box = BOX[stage.size]

    if (!(await read($, isOn)) || e.props.hasSurvey || e.props.maxRows < box.rows) {
      stop(stage)

      return below
    }

    const { Image, Raster } = $.ui.resolve(e)
    stage.band = e.requestId
    // 時計は帯を描いたときに初めて回す（画面の無い実行では回さない）
    stage.timer ??= $.clock.every(TICK_MS, () => tick($, stage))

    if (isImage) {
      const source = picture(drawn(stage))
      stage.shown = source.rgba

      return <Image key={RASTER} source={source} columns={box.columns} rows={box.rows} alt={ALT} />
    }

    stage.shown = frame(stage)

    return <Raster key={RASTER} columns={box.columns} rows={box.rows} cells={stage.shown} />
  })
}
