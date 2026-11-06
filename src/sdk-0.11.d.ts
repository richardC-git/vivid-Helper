// Members Scalpel 1.0.5's host SDK (0.11.0) provides that the newest npm
// release of the types (0.9.0) lacks, plus the fork's getGemListings. Copied from src/plugin-sdk/src/types.ts
// in the Scalpel source; delete once a matching SDK version is published.
import '@scalpelpoe/plugin-sdk'

declare module '@scalpelpoe/plugin-sdk' {
  interface ScalpelPluginContext {
    isOverlayVisible(): Promise<boolean>
    onOverlayVisibility(handler: (visible: boolean) => void): () => void
  }
  interface GemListing {
    name: string
    variant?: string
    gemLevel: number
    gemQuality: number
    corrupted: boolean
    chaosValue: number
    listingCount: number
  }
  interface GemListingsResult {
    lines: GemListing[]
    league: string
    updatedAt: number | null
    error?: string
  }
  interface PricesApi {
    /** Fork-only (Scalpel 1.0.5-gems.12+): PoE1 gem lines with listing counts. Absent on official Scalpel. */
    getGemListings?(): Promise<GemListingsResult>
  }
  interface RegisterOverlayOptions {
    /** Allow transient annotation results to be dismissed by the game's Escape key. Default false. */
    dismissOnEscape?: boolean
    /** Dismiss transient annotation results when clicking the game outside Scalpel controls. */
    dismissOnGameClick?: boolean
  }
}
