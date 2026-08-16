import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useTheme } from 'next-themes';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import * as topojson from 'topojson-client';
import { RegionPoint } from '@/hooks/useDashboardMetrics';
import { cn } from '@/lib/utils';

const BLUR_VALUE_CLASS = 'blur-md select-none transition-[filter] duration-200 ease-out';
const VALUE_TRANSITION_CLASS = 'transition-[filter] duration-200 ease-out';

// Brazilian state capitals coordinates for globe dots
const STATE_COORDS: Record<string, { lat: number; lng: number; name: string }> = {
  SP: { lat: -23.55, lng: -46.63, name: 'São Paulo' },
  RJ: { lat: -22.91, lng: -43.17, name: 'Rio de Janeiro' },
  MG: { lat: -19.92, lng: -43.94, name: 'Minas Gerais' },
  DF: { lat: -15.78, lng: -47.93, name: 'Brasília' },
  BA: { lat: -12.97, lng: -38.51, name: 'Salvador' },
  PR: { lat: -25.43, lng: -49.27, name: 'Curitiba' },
  CE: { lat: -3.72, lng: -38.53, name: 'Fortaleza' },
  PE: { lat: -8.05, lng: -34.87, name: 'Recife' },
  RS: { lat: -30.03, lng: -51.23, name: 'Porto Alegre' },
  AM: { lat: -3.12, lng: -60.02, name: 'Manaus' },
  GO: { lat: -16.68, lng: -49.26, name: 'Goiânia' },
  PA: { lat: -1.46, lng: -48.50, name: 'Belém' },
  SC: { lat: -27.59, lng: -48.55, name: 'Florianópolis' },
  MA: { lat: -2.53, lng: -44.28, name: 'São Luís' },
  PB: { lat: -7.12, lng: -34.86, name: 'João Pessoa' },
  AL: { lat: -9.67, lng: -35.74, name: 'Maceió' },
  MT: { lat: -15.60, lng: -56.10, name: 'Cuiabá' },
  MS: { lat: -20.44, lng: -54.65, name: 'Campo Grande' },
  ES: { lat: -20.32, lng: -40.34, name: 'Vitória' },
  PI: { lat: -5.09, lng: -42.80, name: 'Teresina' },
  RN: { lat: -5.79, lng: -35.21, name: 'Natal' },
  SE: { lat: -10.91, lng: -37.07, name: 'Aracaju' },
  RO: { lat: -8.76, lng: -63.90, name: 'Porto Velho' },
  TO: { lat: -10.18, lng: -48.33, name: 'Palmas' },
  AC: { lat: -9.97, lng: -67.81, name: 'Rio Branco' },
  AP: { lat: 0.03, lng: -51.07, name: 'Macapá' },
  RR: { lat: 2.82, lng: -60.67, name: 'Boa Vista' },
};

// Country coordinates for international sales
const COUNTRY_COORDS: Record<string, { lat: number; lng: number; name: string }> = {
  'MÉXICO': { lat: 19.43, lng: -99.13, name: 'México' },
  'MEXICO': { lat: 19.43, lng: -99.13, name: 'México' },
  'MX': { lat: 19.43, lng: -99.13, name: 'México' },
  'COLOMBIA': { lat: 4.71, lng: -74.07, name: 'Colômbia' },
  'CO': { lat: 4.71, lng: -74.07, name: 'Colômbia' },
  'ARGENTINA': { lat: -34.60, lng: -58.38, name: 'Argentina' },
  'AR': { lat: -34.60, lng: -58.38, name: 'Argentina' },
  'CHILE': { lat: -33.45, lng: -70.67, name: 'Chile' },
  'CL': { lat: -33.45, lng: -70.67, name: 'Chile' },
  'PERU': { lat: -12.05, lng: -77.04, name: 'Peru' },
  'PE': { lat: -12.05, lng: -77.04, name: 'Peru' },
  'ESTADOS UNIDOS': { lat: 38.90, lng: -77.04, name: 'Estados Unidos' },
  'UNITED STATES': { lat: 38.90, lng: -77.04, name: 'Estados Unidos' },
  'US': { lat: 38.90, lng: -77.04, name: 'Estados Unidos' },
  'USA': { lat: 38.90, lng: -77.04, name: 'Estados Unidos' },
  'PORTUGAL': { lat: 38.72, lng: -9.14, name: 'Portugal' },
  'PT': { lat: 38.72, lng: -9.14, name: 'Portugal' },
  'ESPANHA': { lat: 40.42, lng: -3.70, name: 'Espanha' },
  'ESPAÑA': { lat: 40.42, lng: -3.70, name: 'Espanha' },
  'SPAIN': { lat: 40.42, lng: -3.70, name: 'Espanha' },
  'ES': { lat: 40.42, lng: -3.70, name: 'Espanha' },
  'URUGUAI': { lat: -34.88, lng: -56.17, name: 'Uruguai' },
  'URUGUAY': { lat: -34.88, lng: -56.17, name: 'Uruguai' },
  'UY': { lat: -34.88, lng: -56.17, name: 'Uruguai' },
  'PARAGUAI': { lat: -25.26, lng: -57.58, name: 'Paraguai' },
  'PARAGUAY': { lat: -25.26, lng: -57.58, name: 'Paraguai' },
  'PY': { lat: -25.26, lng: -57.58, name: 'Paraguai' },
  'BOLÍVIA': { lat: -16.50, lng: -68.15, name: 'Bolívia' },
  'BOLIVIA': { lat: -16.50, lng: -68.15, name: 'Bolívia' },
  'BO': { lat: -16.50, lng: -68.15, name: 'Bolívia' },
  'EQUADOR': { lat: -0.18, lng: -78.47, name: 'Equador' },
  'ECUADOR': { lat: -0.18, lng: -78.47, name: 'Equador' },
  'EC': { lat: -0.18, lng: -78.47, name: 'Equador' },
  'VENEZUELA': { lat: 10.49, lng: -66.88, name: 'Venezuela' },
  'VE': { lat: 10.49, lng: -66.88, name: 'Venezuela' },
  'CANADÁ': { lat: 45.42, lng: -75.70, name: 'Canadá' },
  'CANADA': { lat: 45.42, lng: -75.70, name: 'Canadá' },
  'CA': { lat: 45.42, lng: -75.70, name: 'Canadá' },
  'ITÁLIA': { lat: 41.90, lng: 12.50, name: 'Itália' },
  'ITALY': { lat: 41.90, lng: 12.50, name: 'Itália' },
  'IT': { lat: 41.90, lng: 12.50, name: 'Itália' },
  'FRANÇA': { lat: 48.86, lng: 2.35, name: 'França' },
  'FRANCE': { lat: 48.86, lng: 2.35, name: 'França' },
  'FR': { lat: 48.86, lng: 2.35, name: 'França' },
  'ALEMANHA': { lat: 52.52, lng: 13.41, name: 'Alemanha' },
  'GERMANY': { lat: 52.52, lng: 13.41, name: 'Alemanha' },
  'DE': { lat: 52.52, lng: 13.41, name: 'Alemanha' },
  'REINO UNIDO': { lat: 51.51, lng: -0.13, name: 'Reino Unido' },
  'UNITED KINGDOM': { lat: 51.51, lng: -0.13, name: 'Reino Unido' },
  'GB': { lat: 51.51, lng: -0.13, name: 'Reino Unido' },
  'UK': { lat: 51.51, lng: -0.13, name: 'Reino Unido' },
  'JAPÃO': { lat: 35.68, lng: 139.69, name: 'Japão' },
  'JAPAN': { lat: 35.68, lng: 139.69, name: 'Japão' },
  'JP': { lat: 35.68, lng: 139.69, name: 'Japão' },
  'AUSTRÁLIA': { lat: -33.87, lng: 151.21, name: 'Austrália' },
  'AUSTRALIA': { lat: -33.87, lng: 151.21, name: 'Austrália' },
  'AU': { lat: -33.87, lng: 151.21, name: 'Austrália' },
};

const BRAZIL_ID = '076';

interface GlobePoint { x: number; y: number; z: number; }

function latLngTo3D(lat: number, lng: number): GlobePoint {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = lng * (Math.PI / 180);
  return {
    x: -Math.sin(phi) * Math.cos(theta),
    y: Math.cos(phi),
    z: Math.sin(phi) * Math.sin(theta),
  };
}

function rotateY(p: GlobePoint, a: number): GlobePoint {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c - p.z * s, y: p.y, z: p.x * s + p.z * c };
}

function rotateX(p: GlobePoint, a: number): GlobePoint {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
}

function project(p: GlobePoint, cx: number, cy: number, r: number) {
  return { x: cx + p.x * r, y: cy - p.y * r, visible: p.z > -0.05 };
}

interface CountryGeo {
  id: string;
  rings: [number, number][][]; // each ring is array of [lng, lat]
}

interface SalesGlobeProps {
  loading: boolean;
  regions?: RegionPoint[];
  blurValues?: boolean;
}

interface GlobePalette {
  sphereInner: string;
  sphereMid: string;
  sphereOuter: string;
  grid: string;
  countryFill: string;
  countryFillNeighbor: string;
  countryStroke: string;
  brazilFill: string;
  brazilStroke: string;
  edge: string;
  /** Heatmap dot/glow color expressed as the "R, G, B" channels (alpha applied dynamically). */
  heatRgb: string;
}

const DARK_PALETTE: GlobePalette = {
  sphereInner: 'rgba(35, 37, 38, 0.5)',
  sphereMid: 'rgba(22, 23, 24, 0.45)',
  sphereOuter: 'rgba(12, 13, 13, 0.35)',
  grid: 'rgba(161, 164, 165, 0.06)',
  countryFill: 'rgba(161, 164, 165, 0.05)',
  countryFillNeighbor: 'rgba(161, 164, 165, 0.09)',
  countryStroke: 'rgba(161, 164, 165, 0.15)',
  brazilFill: 'rgba(161, 164, 165, 0.20)',
  brazilStroke: 'rgba(62, 143, 216, 0.3)',
  edge: 'rgba(161, 164, 165, 0.08)',
  heatRgb: '62, 143, 216',
};

const LIGHT_PALETTE: GlobePalette = {
  sphereInner: 'rgba(245, 245, 245, 0.7)',
  sphereMid: 'rgba(230, 230, 230, 0.55)',
  sphereOuter: 'rgba(210, 210, 210, 0.4)',
  grid: 'rgba(60, 60, 60, 0.10)',
  countryFill: 'rgba(80, 80, 80, 0.06)',
  countryFillNeighbor: 'rgba(80, 80, 80, 0.12)',
  countryStroke: 'rgba(80, 80, 80, 0.20)',
  brazilFill: 'rgba(80, 80, 80, 0.15)',
  brazilStroke: 'rgba(27, 85, 136, 0.55)',
  edge: 'rgba(80, 80, 80, 0.15)',
  heatRgb: '27, 85, 136',
};

export function SalesGlobe({ loading, regions = [], blurValues }: SalesGlobeProps) {
  const blurClass = blurValues ? BLUR_VALUE_CLASS : VALUE_TRANSITION_CLASS;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const rotYRef = useRef(0.62);
  const rotXRef = useRef(-0.22);
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const autoRotateRef = useRef(true);
  const autoRotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const velocityRef = useRef({ x: 0, y: 0 });
  const [countries, setCountries] = useState<CountryGeo[]>([]);
  const { resolvedTheme } = useTheme();
  const paletteRef = useRef<GlobePalette>(resolvedTheme === 'light' ? LIGHT_PALETTE : DARK_PALETTE);
  paletteRef.current = resolvedTheme === 'light' ? LIGHT_PALETTE : DARK_PALETTE;

  // Build hotspot data from real regions or fallback
  const hotspots = useMemo(() => {
    if (regions.length > 0) {
      return regions
        .map(r => {
          const coords = STATE_COORDS[r.state] || COUNTRY_COORDS[r.state.toUpperCase()];
          if (!coords) return null;
          return {
            name: coords.name,
            lat: coords.lat,
            lng: coords.lng,
            weight: r.percentage / 100,
            sales: r.sales,
          };
        })
        .filter(Boolean) as { name: string; lat: number; lng: number; weight: number; sales: number }[];
    }
    return [];
  }, [regions]);

  // Load real world data
  useEffect(() => {
    import('world-atlas/countries-110m.json').then((topoData) => {
      const topo = topoData.default || topoData;
      const geojson = topojson.feature(topo as any, (topo as any).objects.countries) as any;
      const parsed: CountryGeo[] = [];

      for (const feature of geojson.features) {
        const id = feature.id || feature.properties?.id || '';
        const rings: [number, number][][] = [];

        if (feature.geometry.type === 'Polygon') {
          for (const ring of feature.geometry.coordinates) {
            rings.push(ring as [number, number][]);
          }
        } else if (feature.geometry.type === 'MultiPolygon') {
          for (const polygon of feature.geometry.coordinates) {
            for (const ring of polygon) {
              rings.push(ring as [number, number][]);
            }
          }
        }
        parsed.push({ id: String(id), rings });
      }

      setCountries(parsed);
    });
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDraggingRef.current = true;
    autoRotateRef.current = false;
    velocityRef.current = { x: 0, y: 0 };
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (autoRotateTimerRef.current) clearTimeout(autoRotateTimerRef.current);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    const vx = -dx * 0.005;
    const vy = dy * 0.005;
    rotYRef.current += vx;
    rotXRef.current = Math.max(-1.2, Math.min(1.2, rotXRef.current + vy));
    velocityRef.current = { x: vx * 0.6 + velocityRef.current.x * 0.4, y: vy * 0.6 + velocityRef.current.y * 0.4 };
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false;
    autoRotateTimerRef.current = setTimeout(() => { autoRotateRef.current = true; }, 4000);
  }, []);

  // Store hotspots in ref for render loop
  const hotspotsRef = useRef(hotspots);
  hotspotsRef.current = hotspots;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    const render = () => {
      if (!running) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w === 0 || h === 0) { animationRef.current = requestAnimationFrame(render); return; }

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);

      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) * 0.82;

      ctx.clearRect(0, 0, w, h);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();

      const ry = rotYRef.current;
      const rx = rotXRef.current;
      const palette = paletteRef.current;

      // Globe sphere background
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(cx - radius * 0.15, cy - radius * 0.15, 0, cx, cy, radius);
      grad.addColorStop(0, palette.sphereInner);
      grad.addColorStop(0.6, palette.sphereMid);
      grad.addColorStop(1, palette.sphereOuter);
      ctx.fillStyle = grad;
      ctx.fill();

      // Grid lines
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 0.5;

      for (let lat = -80; lat <= 80; lat += 20) {
        ctx.beginPath();
        let started = false;
        for (let lng = -180; lng <= 180; lng += 3) {
          let pt = latLngTo3D(lat, lng);
          pt = rotateY(pt, ry);
          pt = rotateX(pt, rx);
          const p = project(pt, cx, cy, radius);
          if (p.visible) {
            if (!started) { ctx.moveTo(p.x, p.y); started = true; }
            else ctx.lineTo(p.x, p.y);
          } else started = false;
        }
        ctx.stroke();
      }

      for (let lng = -180; lng < 180; lng += 30) {
        ctx.beginPath();
        let started = false;
        for (let lat = -90; lat <= 90; lat += 3) {
          let pt = latLngTo3D(lat, lng);
          pt = rotateY(pt, ry);
          pt = rotateX(pt, rx);
          const p = project(pt, cx, cy, radius);
          if (p.visible) {
            if (!started) { ctx.moveTo(p.x, p.y); started = true; }
            else ctx.lineTo(p.x, p.y);
          } else started = false;
        }
        ctx.stroke();
      }

      // Draw countries
      if (countries.length > 0) {
        for (const country of countries) {
          if (country.id === BRAZIL_ID) continue;
          const isBrazilNeighbor = ['032','858','600','068','170','604','328','740','862'].includes(country.id);

          for (const ring of country.rings) {
            ctx.beginPath();
            let started = false;
            let prevVis = false;

            for (const [lng, lat] of ring) {
              let pt = latLngTo3D(lat, lng);
              pt = rotateY(pt, ry);
              pt = rotateX(pt, rx);
              const p = project(pt, cx, cy, radius);
              if (p.visible) {
                if (!started || !prevVis) { ctx.moveTo(p.x, p.y); started = true; }
                else ctx.lineTo(p.x, p.y);
                prevVis = true;
              } else prevVis = false;
            }

            ctx.closePath();
            ctx.fillStyle = isBrazilNeighbor
              ? palette.countryFillNeighbor
              : palette.countryFill;
            ctx.fill();
            ctx.strokeStyle = palette.countryStroke;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }

        const brazil = countries.find(c => c.id === BRAZIL_ID);
        if (brazil) {
          for (const ring of brazil.rings) {
            ctx.beginPath();
            let started = false;
            let prevVis = false;

            for (const [lng, lat] of ring) {
              let pt = latLngTo3D(lat, lng);
              pt = rotateY(pt, ry);
              pt = rotateX(pt, rx);
              const p = project(pt, cx, cy, radius);
              if (p.visible) {
                if (!started || !prevVis) { ctx.moveTo(p.x, p.y); started = true; }
                else ctx.lineTo(p.x, p.y);
                prevVis = true;
              } else prevVis = false;
            }

            ctx.closePath();
            ctx.fillStyle = palette.brazilFill;
            ctx.fill();
            ctx.strokeStyle = palette.brazilStroke;
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        }
      }

      // Heatmap dots from real data
      const currentHotspots = hotspotsRef.current;
      currentHotspots.forEach((spot) => {
        let pt = latLngTo3D(spot.lat, spot.lng);
        pt = rotateY(pt, ry);
        pt = rotateX(pt, rx);
        const p = project(pt, cx, cy, radius);

        if (p.visible) {
          const w = Math.min(spot.weight, 1);
          const dotR = radius * (0.008 + w * 0.04);

          const heat = palette.heatRgb;
          const glowR = dotR * 5;
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
          glow.addColorStop(0, `rgba(${heat}, ${Math.min(0.5, w * 1.5)})`);
          glow.addColorStop(0.3, `rgba(${heat}, ${Math.min(0.2, w * 0.6)})`);
          glow.addColorStop(1, `rgba(${heat}, 0)`);
          ctx.beginPath();
          ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();

          const core = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, dotR);
          core.addColorStop(0, `rgba(${heat}, 0.95)`);
          core.addColorStop(0.6, `rgba(${heat}, 0.6)`);
          core.addColorStop(1, `rgba(${heat}, 0.2)`);
          ctx.beginPath();
          ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2);
          ctx.fillStyle = core;
          ctx.fill();
        }
      });

      // Globe edge
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = palette.edge;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();

      if (!isDraggingRef.current) {
        const vel = velocityRef.current;
        if (Math.abs(vel.x) > 0.00005 || Math.abs(vel.y) > 0.00005) {
          rotYRef.current += vel.x;
          rotXRef.current = Math.max(-1.2, Math.min(1.2, rotXRef.current + vel.y));
          velocityRef.current = { x: vel.x * 0.95, y: vel.y * 0.95 };
        } else {
          velocityRef.current = { x: 0, y: 0 };
          if (autoRotateRef.current) {
            rotYRef.current -= 0.0006;
          }
        }
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      running = false;
      cancelAnimationFrame(animationRef.current);
      if (autoRotateTimerRef.current) clearTimeout(autoRotateTimerRef.current);
    };
  }, [countries]);

  const heatRgb = resolvedTheme === 'light' ? LIGHT_PALETTE.heatRgb : DARK_PALETTE.heatRgb;

  const renderRegionRow = (region: typeof hotspots[0]) => (
    <div key={region.name} className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <div
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{
            backgroundColor: `rgba(${heatRgb}, ${0.4 + Math.min(region.weight, 1) * 2})`,
            boxShadow: `0 0 4px rgba(${heatRgb}, ${Math.min(region.weight, 1) * 2})`,
          }}
        />
        <span className="text-[10px] text-muted-foreground/80">{region.name}</span>
      </div>
      <span className={cn('text-[10px] text-muted-foreground/60 tabular-nums', blurClass)}>
        {region.sales} {region.sales === 1 ? 'venda' : 'vendas'} · {(region.weight * 100).toFixed(0)}%
      </span>
    </div>
  );

  return (
    <Card className="flex flex-col" style={{ overflow: 'hidden' }}>
      <CardHeader className="pb-0 pt-4 px-4 shrink-0">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Vendas por região
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col pt-0 px-0 pb-3">
        <div className={cn('relative cursor-grab active:cursor-grabbing h-[260px]', blurClass, blurValues && 'pointer-events-none')}>
          <canvas
            ref={canvasRef}
            className="w-full h-full"
            style={{ display: 'block', touchAction: 'none' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          />
        </div>
        <div className="px-4 mt-1">
          {loading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-3 w-20 bg-foreground/5" />
                  <Skeleton className="h-3 w-8 bg-foreground/5" />
                </div>
              ))}
            </div>
          ) : hotspots.length > 0 ? (
            <div className="max-h-[54px] overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-foreground/10 scrollbar-track-transparent">
              {hotspots.map(renderRegionRow)}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground/50 text-center">
              Sem dados de região no período
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
