import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { onPlanLimitExceeded } from '@/lib/api';

const RESOURCE_LABEL: Record<string, string> = {
  workspace:   'workspaces',
  ad_account:  'contas de anúncio ativas',
  integration: 'integrações de checkout',
  active_rule: 'regras de automação ativas',
};

export function PlanLimitModal() {
  const [detail, setDetail] = useState<any | null>(null);
  const navigate = useNavigate();

  useEffect(() => onPlanLimitExceeded(setDetail), []);

  if (!detail) return null;

  const label = RESOURCE_LABEL[detail.resource] ?? detail.resource;

  return (
    <Dialog open onOpenChange={() => setDetail(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Limite do plano atingido</DialogTitle>
          <DialogDescription>
            Seu plano <strong>{detail.plan}</strong> permite {detail.limit} {label}.
            Você está usando {detail.current}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDetail(null)}>Fechar</Button>
          <Button onClick={() => { setDetail(null); navigate('/settings?tab=plan'); }}>
            Fazer upgrade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
