import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CheckoutPlatform, CHECKOUT_PLATFORMS } from '@/types/checkout';

interface PlatformSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPlatform: (platform: CheckoutPlatform) => void;
}

const PLATFORM_LOGOS: Partial<Record<CheckoutPlatform, { src: string; alt: string }>> = {
  hotmart: { src: '/hotmart-logo.png', alt: 'Hotmart' },
  kiwify: { src: '/kiwify-logo.jpg', alt: 'Kiwify' },
  kirvano: { src: '/kirvano-logo.png', alt: 'Kirvano' },
  guru: { src: '/guru-logo.jpg', alt: 'Guru Digital' },
  perfectpay: { src: '/perfectpay-logo.png', alt: 'Perfect Pay' },
  ticto: { src: '/ticto-logo.png', alt: 'Ticto' },
  payt: { src: '/payt-logo.png', alt: 'PayT' },
  cakto: { src: '/cakto-logo.jpg', alt: 'Cakto' },
  hubla: { src: '/hubla-logo.svg', alt: 'Hubla' },
  cartpanda: { src: '/cartpanda-logo.avif', alt: 'CartPanda' },
  ggcheckout: { src: '/ggcheckout-logo.png', alt: 'GG Checkout' },
  lastlink: { src: '/lastlink-logo.ico', alt: 'LastLink' },
  eduzz: { src: '/eduzz-logo.png', alt: 'Eduzz' },
  mundpay: { src: '/mundpay-logo.svg', alt: 'Mundpay' },
  monetizze: { src: '/monetizze-logo.svg', alt: 'Monetizze' },
  greenn: { src: '/greenn-logo.webp', alt: 'Greenn' },
};

const ALL_PLATFORMS: CheckoutPlatform[] = [
  'hotmart', 'kiwify', 'kirvano', 'guru', 'perfectpay', 'ticto', 'payt', 'cakto',
  'hubla', 'cartpanda', 'ggcheckout', 'lastlink',
  'eduzz', 'mundpay', 'monetizze', 'greenn',
  'wiven', 'frendz', 'herospark', 'kavoo', 'pagtrust', 'assiny', 'yampi', 'wiapy', 'doppus',
];

export function PlatformSelectorModal({
  open,
  onOpenChange,
  onSelectPlatform,
}: PlatformSelectorModalProps) {
  const handleSelect = (platform: CheckoutPlatform) => {
    onOpenChange(false);
    onSelectPlatform(platform);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>Adicionar integração</DialogTitle>
          <DialogDescription>
            Selecione a plataforma de checkout
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 py-2 sm:grid-cols-4">
          {ALL_PLATFORMS.map((platform) => {
            const config = CHECKOUT_PLATFORMS[platform];
            const logo = PLATFORM_LOGOS[platform];

            return (
              <button
                key={platform}
                onClick={() => handleSelect(platform)}
                className="flex flex-col items-center gap-2 rounded-lg border border-foreground/5 px-2 py-3 hover:bg-foreground/[0.03] transition-colors cursor-pointer"
              >
                {logo ? (
                  <img src={logo.src} alt={logo.alt} className="h-10 w-10 rounded-lg object-cover" />
                ) : (
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${config.color} text-sm font-bold text-foreground`}>
                    {config.name.substring(0, 2)}
                  </div>
                )}
                <span className="text-center text-xs font-medium leading-tight">{config.name}</span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
