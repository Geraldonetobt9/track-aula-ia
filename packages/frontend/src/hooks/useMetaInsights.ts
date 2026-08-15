import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useFacebookConnection } from './useFacebookConnection';
import { mockDashboardMetrics, mockChartData, mockPieData, mockCampaigns } from '@/data/mockData';

interface DashboardMetrics {
  grossRevenue: number;
  grossRevenueChange: number;
  netRevenue: number;
  netRevenueChange: number;
  adSpend: number;
  adSpendChange: number;
  salesCount: number;
  salesCountChange: number;
  roi: number;
  roiChange: number;
  roas: number;
  roasChange: number;
  cpa: number;
  cpaChange: number;
}

export function useMetaInsights(period: string = 'last_7d') {
  const [metrics, setMetrics] = useState<DashboardMetrics>(mockDashboardMetrics);
  const [chartData, setChartData] = useState(mockChartData);
  const [pieData, setPieData] = useState(mockPieData);
  const [campaigns, setCampaigns] = useState(mockCampaigns);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usingMockData, setUsingMockData] = useState(true);

  const { user } = useAuth();
  const { isConfigured, isValid } = useFacebookConnection();

  const fetchInsights = async () => {
    if (!user?.id || !isConfigured || !isValid) {
      // Use mock data when not configured
      setUsingMockData(true);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await api.post<any>('/facebook/insights/validate', {
        date_preset: period,
      });

      if (!data?.success) {
        setUsingMockData(true);
        return;
      }

      // Process real insights data here
      if (data.insights && data.insights.length > 0) {
        const insight = data.insights[0];

        // Update metrics with real data
        setMetrics(prev => ({
          ...prev,
          adSpend: parseFloat(insight.spend) || prev.adSpend,
        }));

        setUsingMockData(false);
      } else {
        setUsingMockData(true);
      }
    } catch (err: any) {
      console.error('Error fetching insights:', err);
      setError(err.message);
      setUsingMockData(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsights();
  }, [user?.id, isConfigured, isValid, period]);

  return {
    metrics,
    chartData,
    pieData,
    campaigns,
    loading,
    error,
    usingMockData,
    refetch: fetchInsights,
  };
}
