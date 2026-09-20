import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Chancela - Identity, Authorization and Accountability for AI Agents';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The link preview.
 *
 * A submission link gets pasted into a judging sheet, a Discord channel and a
 * browser tab. Without this it previews as a bare URL. Built from the same
 * palette as the product so the card and the page look like one thing.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: '#090A0D',
          padding: '80px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, color: '#7E7AFF', fontSize: 30 }}>
          <div style={{ width: 14, height: 14, borderRadius: 999, background: '#7E7AFF' }} />
          Chancela
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 34 }}>
          <div style={{ fontSize: 76, color: '#EEF1F6', letterSpacing: -2, lineHeight: 1.05 }}>
            Give AI agents an identity.
          </div>
          <div style={{ fontSize: 76, color: '#949CA9', letterSpacing: -2, lineHeight: 1.05 }}>
            And a limit.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14, marginTop: 44, fontSize: 27 }}>
          <span style={{ color: '#949CA9' }}>The LLM interprets.</span>
          <span style={{ color: '#38CB81' }}>The policy engine authorizes.</span>
          <span style={{ color: '#7E7AFF' }}>Monad remembers.</span>
        </div>

        <div style={{ display: 'flex', marginTop: 'auto', fontSize: 23, color: '#646C79' }}>
          Monad Metropolis 2026 · Trust, Identity &amp; AI Infrastructure
        </div>
      </div>
    ),
    size,
  );
}
