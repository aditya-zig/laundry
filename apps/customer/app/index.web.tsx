import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Service } from '@wandary/contracts';
import { demoSignIn, getClient, getToken } from '../src/api';
import ClassicStorefront from '../src/storefronts/ClassicStorefront.web';
import HandledStorefront from '../src/storefronts/HandledStorefront.web';
import type { StorefrontProps } from '../src/storefronts/types';

export default function Home() {
  const router = useRouter();
  const params = useLocalSearchParams<{ design?: string }>();
  const [variant, setVariant] = useState<'classic' | 'handled'>(() => {
    if (params.design === 'handled' || params.design === 'classic') return params.design;
    try { return localStorage.getItem('laundry.storefront') === 'handled' ? 'handled' : 'classic'; }
    catch { return 'classic'; }
  });
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState('Bengaluru 560001');

  const browse = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const images: Record<string, string> = {
        WASH_PRESS: 'wash-and-iron.png', DRY_CLEAN: 'dry-clean.png',
        WASH_FOLD: 'wash-and-fold.png', PRESS_ONLY: 'steam-press.png',
      };
      setServices((await getClient().listServices()).map(service => ({
        ...service,
        imageUrl: images[service.code] ? `/assets/services/${images[service.code]}` : service.imageUrl,
      })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Services could not load. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void browse(); }, [browse]);
  useEffect(() => {
    if (params.design === 'handled' || params.design === 'classic') setVariant(params.design);
  }, [params.design]);
  useEffect(() => {
    try { localStorage.setItem('laundry.storefront', variant); } catch { /* Preference is optional. */ }
  }, [variant]);

  async function selectService(id: string) {
    setError(null);
    try {
      if (!getToken()) await demoSignIn();
      router.push({ pathname: '/services/[id]', params: { id } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Demo sign-in failed. Please try again.');
    }
  }

  const props: StorefrontProps = {
    services, loading, error, address,
    onAddressChange: setAddress,
    onBrowse: () => { void browse(); },
    onSelectService: (id) => { void selectService(id); },
    onNavigate: (path) => router.push(path),
    variant,
    onVariantChange: (design) => { setVariant(design); router.setParams({ design }); },
  };
  return variant === 'handled' ? <HandledStorefront {...props} /> : <ClassicStorefront {...props} />;
}
