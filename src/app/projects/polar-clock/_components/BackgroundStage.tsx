'use client';

import dynamic from 'next/dynamic';
import type { BackgroundKey } from './shared';

// Projector slides are deliberately split into separate chunks. Most are
// canvas/WebGL-heavy and should not join the clock's initial JavaScript when
// the dome starts dark.
const GOLBackground = dynamic(() => import('./GOLBackground').then(m => m.GOLBackground), { ssr: false });
const JuliaBackground = dynamic(() => import('./Fractal').then(m => m.JuliaBackground), { ssr: false });
const MandelbrotBackground = dynamic(() => import('./Fractal').then(m => m.MandelbrotBackground), { ssr: false });
const BurningShipBackground = dynamic(() => import('./Fractal').then(m => m.BurningShipBackground), { ssr: false });
const NewtonBackground = dynamic(() => import('./Fractal').then(m => m.NewtonBackground), { ssr: false });
const ResonanceBackground = dynamic(() => import('./Fractal').then(m => m.ResonanceBackground), { ssr: false });
const AttractorBackground = dynamic(() => import('./AttractorBackground').then(m => m.AttractorBackground), { ssr: false });
const KochBackground = dynamic(() => import('./KochBackground').then(m => m.KochBackground), { ssr: false });
const StarfieldBackground = dynamic(() => import('./StarfieldBackground').then(m => m.StarfieldBackground), { ssr: false });
const ParticleFlowBackground = dynamic(() => import('./ParticleFlowBackground').then(m => m.ParticleFlowBackground), { ssr: false });
const MatrixRainBackground = dynamic(() => import('./MatrixRainBackground').then(m => m.MatrixRainBackground), { ssr: false });
const VoronoiBackground = dynamic(() => import('./VoronoiBackground').then(m => m.VoronoiBackground), { ssr: false });
const RipplesBackground = dynamic(() => import('./RipplesBackground').then(m => m.RipplesBackground), { ssr: false });
const LissajousBackground = dynamic(() => import('./LissajousBackground').then(m => m.LissajousBackground), { ssr: false });
const SineWaveBackground = dynamic(() => import('./SineWaveBackground').then(m => m.SineWaveBackground), { ssr: false });
const ApollonianBackground = dynamic(() => import('./ApollonianBackground').then(m => m.ApollonianBackground), { ssr: false });
const SpectrumBackground = dynamic(() => import('./AudioBackgrounds').then(m => m.SpectrumBackground), { ssr: false });
const OrbBackground = dynamic(() => import('./AudioBackgrounds').then(m => m.OrbBackground), { ssr: false });
const AuroraBackground = dynamic(() => import('./AudioBackgrounds').then(m => m.AuroraBackground), { ssr: false });
const RadialSpectrumBackground = dynamic(() => import('./AudioBackgrounds').then(m => m.RadialSpectrumBackground), { ssr: false });
const TerrainBackground = dynamic(() => import('./AudioBackgrounds').then(m => m.TerrainBackground), { ssr: false });
const TunnelBackground = dynamic(() => import('./AudioBackgrounds').then(m => m.TunnelBackground), { ssr: false });
const RibbonBackground = dynamic(() => import('./AudioBackgrounds').then(m => m.RibbonBackground), { ssr: false });

interface BackgroundStageProps {
  background: BackgroundKey;
  width: number;
  height: number;
  juliaManual: boolean;
  juliaCRe: number;
  juliaCIm: number;
  juliaDragging: boolean;
}

export function BackgroundStage({
  background, width, height, juliaManual, juliaCRe, juliaCIm, juliaDragging,
}: BackgroundStageProps) {
  const props = { width, height };

  switch (background) {
    case 'gol': return <GOLBackground {...props} />;
    case 'julia': return <JuliaBackground {...props} manual={juliaManual} cRe={juliaCRe} cIm={juliaCIm} dragging={juliaDragging} />;
    case 'mandelbrot': return <MandelbrotBackground {...props} />;
    case 'burningship': return <BurningShipBackground {...props} />;
    case 'newton': return <NewtonBackground {...props} />;
    case 'attractor': return <AttractorBackground {...props} />;
    case 'koch': return <KochBackground {...props} />;
    case 'starfield': return <StarfieldBackground {...props} />;
    case 'particles': return <ParticleFlowBackground {...props} />;
    case 'matrix': return <MatrixRainBackground {...props} />;
    case 'voronoi': return <VoronoiBackground {...props} />;
    case 'ripples': return <RipplesBackground {...props} />;
    case 'lissajous': return <LissajousBackground {...props} />;
    case 'sinewaves': return <SineWaveBackground {...props} />;
    case 'apollonian': return <ApollonianBackground {...props} />;
    case 'resonance': return <ResonanceBackground {...props} />;
    case 'terrain': return <TerrainBackground {...props} />;
    case 'tunnel': return <TunnelBackground {...props} />;
    case 'ribbon': return <RibbonBackground {...props} />;
    case 'spectrum': return <SpectrumBackground {...props} />;
    case 'orb': return <OrbBackground {...props} />;
    case 'aurora': return <AuroraBackground {...props} />;
    case 'radial': return <RadialSpectrumBackground {...props} />;
    default: return null;
  }
}
