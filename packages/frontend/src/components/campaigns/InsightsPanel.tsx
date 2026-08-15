import { Card, CardContent } from '@/components/ui/card';
import { TopAdsChart, TopAdData } from './TopAdsChart';
import { ConversionFunnel } from '@/components/dashboard/ConversionFunnel';

interface FunnelData {
  linkClicks: number;
  landingPageViews: number;
  initiateCheckouts: number;
  sales: number;
  loading: boolean;
}

interface InsightsPanelProps {
  topAds: TopAdData[];
  metaTopAds: TopAdData[];
  topAdsLoading: boolean;
  funnelData: FunnelData;
  attributionMode: 'lastclick' | 'meta';
}

export function InsightsPanel({ topAds, metaTopAds, topAdsLoading, funnelData, attributionMode }: InsightsPanelProps) {
  const displayTopAds = attributionMode === 'lastclick' ? topAds : metaTopAds;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Card>
        <CardContent className="p-4">
          <TopAdsChart
            topAds={displayTopAds}
            metaTopAds={[]}
            loading={topAdsLoading}
            title={`Top 5 Anuncios (${attributionMode === 'lastclick' ? 'Last Click' : 'Meta'})`}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <ConversionFunnel
            linkClicks={funnelData.linkClicks}
            landingPageViews={funnelData.landingPageViews}
            initiateCheckouts={funnelData.initiateCheckouts}
            sales={funnelData.sales}
            loading={funnelData.loading}
          />
        </CardContent>
      </Card>
    </div>
  );
}
