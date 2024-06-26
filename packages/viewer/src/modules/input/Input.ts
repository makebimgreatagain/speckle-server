import { Vector2 } from 'three'
import EventEmitter from '../EventEmitter'

export interface InputOptions {
  hover: boolean
}

export const InputOptionsDefault = {
  hover: false
}

export enum InputEvent {
  PointerDown,
  PointerUp,
  PointerMove,
  Click,
  DoubleClick,
  KeyUp
}

export default class Input extends EventEmitter {
  private static readonly MAX_DOUBLE_CLICK_TIMING = 500
  private tapTimeout
  private lastTap = 0
  private lastClick = 0
  private touchLocation: Touch
  private container

  constructor(container: HTMLElement, _options: InputOptions) {
    super()
    _options
    this.container = container

    // Handle mouseclicks
    let mdTime
    this.container.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      const loc = this._getNormalisedClickPosition(e)
      ;(loc as unknown as Record<string, unknown>).event = e
      mdTime = new Date().getTime()
      this.emit(InputEvent.PointerDown, loc)
    })

    this.container.addEventListener('pointerup', (e) => {
      e.preventDefault()
      const loc = this._getNormalisedClickPosition(e)
      ;(loc as unknown as Record<string, unknown>).event = e

      this.emit(InputEvent.PointerUp, loc)
      const now = new Date().getTime()
      const delta = now - mdTime
      const deltaClick = now - this.lastClick

      if (delta > 250 || deltaClick < Input.MAX_DOUBLE_CLICK_TIMING) return

      if (e.shiftKey) (loc as unknown as Record<string, unknown>).multiSelect = true
      this.emit(InputEvent.Click, loc)
      this.lastClick = new Date().getTime()
    })

    // Doubleclicks on touch devices
    // http://jsfiddle.net/brettwp/J4djY/
    this.container.addEventListener('touchstart', (e) => {
      this.touchLocation = e.targetTouches[0]
    })
    this.container.addEventListener('touchend', (e) => {
      // Ignore the first `touchend` when pinch-zooming (so we don't consider double-tap)
      if (e.targetTouches.length > 0) {
        return
      }
      const currentTime = new Date().getTime()
      const tapLength = currentTime - this.lastTap
      clearTimeout(this.tapTimeout)
      if (tapLength < 500 && tapLength > 0) {
        const loc = this._getNormalisedClickPosition(this.touchLocation)
        this.emit(InputEvent.DoubleClick, loc)
      } else {
        this.tapTimeout = setTimeout(function () {
          clearTimeout(this.tapTimeout)
        }, 500)
      }
      this.lastTap = currentTime
    })

    this.container.addEventListener('dblclick', (e) => {
      const data = this._getNormalisedClickPosition(e)
      ;(data as unknown as Record<string, unknown>).event = e
      this.emit(InputEvent.DoubleClick, data)
    })

    this.container.addEventListener('pointermove', (e) => {
      const data = this._getNormalisedClickPosition(e)
      ;(data as unknown as Record<string, unknown>).event = e
      this.emit('pointer-move', data)
      this.emit(InputEvent.PointerMove, data)
    })

    document.addEventListener('keyup', (e) => {
      this.emit('key-up', e)
      this.emit(InputEvent.KeyUp, e)
    })

    // Handle multiple object selection
    // document.addEventListener('keydown', (e) => {
    //   if (e.isComposing || e.keyCode === 229) return
    //   if (e.key === 'Shift') this.multiSelect = true
    // })

    // document.addEventListener('keyup', (e) => {
    //   if (e.isComposing || e.keyCode === 229) return
    //   if (e.key === 'Shift') this.multiSelect = false
    // })
  }

  _getNormalisedClickPosition(e) {
    // Reference: https://threejsfundamentals.org/threejs/lessons/threejs-picking.html
    const canvas = this.container
    const rect = this.container.getBoundingClientRect()

    const pos = {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height
    }
    const v = new Vector2(
      (pos.x / canvas.width) * 2 - 1,
      (pos.y / canvas.height) * -2 + 1
    )
    // console.warn(v)
    return v
  }

  dispose() {
    super.dispose()
  }
}
