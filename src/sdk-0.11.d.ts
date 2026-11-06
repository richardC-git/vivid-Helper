// Members Scalpel 1.0.5's host SDK (0.11.0) provides that the newest npm
// release of the types (0.9.0) lacks. Copied from src/plugin-sdk/src/types.ts
// in the Scalpel source; delete once a matching SDK version is published.
import '@scalpelpoe/plugin-sdk'

declare module '@scalpelpoe/plugin-sdk' {
  interface ScalpelPluginContext {
    isOverlayVisible(): Promise<boolean>
    onOverlayVisibility(handler: (visible: boolean) => void): () => void
  }
  interface RegisterOverlayOptions {
    /** Allow transient annotation results to be dismissed by the game's Escape key. Default false. */
    dismissOnEscape?: boolean
    /** Dismiss transient annotation results when clicking the game outside Scalpel controls. */
    dismissOnGameClick?: boolean
  }
}
