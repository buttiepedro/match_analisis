import { create } from "zustand";
import type { ClubBranding } from "../lib/branding";

interface BrandingState {
  branding: ClubBranding | null;
  setBranding: (branding: ClubBranding | null) => void;
}

/**
 * Sólo lo que `Layout.tsx` necesita para pintar el logo en el header
 * (`--brand`, título y favicon los aplica `lib/branding.ts` directo al DOM,
 * sin pasar por React). No persiste: se re-pide en cada carga, como el resto
 * de lo que depende de la instancia. Ver [[add-club-subdominios-y-marca]].
 */
export const useBrandingStore = create<BrandingState>()((set) => ({
  branding: null,
  setBranding: (branding) => set({ branding }),
}));
