export type DotpetSize = 'big' | 'small' | 'image' | 'still'

declare module 'claude-code' {
  interface PluginState {
    dotpet: { isOn: boolean; size: DotpetSize; redraw: number }
  }
}
