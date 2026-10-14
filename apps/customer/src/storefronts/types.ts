import type { Service } from '@wandary/contracts';

export type StorefrontProps = {
  services: Service[];
  loading: boolean;
  error: string | null;
  address: string;
  onAddressChange: (value: string) => void;
  onBrowse: () => void;
  onSelectService: (id: string) => void;
  onNavigate: (path: '/orders' | '/basket' | '/help' | '/account') => void;
  variant: 'classic' | 'handled';
  onVariantChange: (variant: 'classic' | 'handled') => void;
};
