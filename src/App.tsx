import { useEffect, useState } from 'react';
import { getSetting, requestPersistentStorage, setSetting } from './lib/db';
import { warmOcr } from './lib/ocr';
import { sharePending, startSharing } from './lib/sync';
import { S } from './strings';
import { Home } from './screens/Home';
import { StartTrip } from './screens/StartTrip';
import { Shopping } from './screens/Shopping';
import { Cashier } from './screens/Cashier';
import { Settings } from './screens/Settings';
import { OcrCheck } from './screens/OcrCheck';
import { Results } from './screens/Results';
import { Search } from './screens/Search';

type Route = 'loading' | 'home' | 'start' | 'shop' | 'cashier' | 'settings' | 'ocrcheck' | 'results' | 'search';

export default function App() {
  const [route, setRoute] = useState<Route>('loading');
  const [tripId, setTripId] = useState<number | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    requestPersistentStorage();
    // Start the OCR engine now so the first tag photo doesn't wait for it.
    warmOcr().catch((e) => console.warn('OCR warm-up failed', e));
    // Uploads finished trips that didn't make it last time (dev app only for now).
    startSharing();
    (async () => {
      setTestMode((await getSetting('testMode')) === '1');
      const active = Number(await getSetting('activeTripId'));
      // Reopening the app mid-trip goes straight back to the list.
      if (active) {
        setTripId(active);
        setRoute('shop');
      } else setRoute('home');
    })();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  switch (route) {
    case 'loading':
      return <main className="screen" />;
    case 'home':
      return (
        <Home
          activeTripId={tripId}
          toast={toast}
          onStart={() => setRoute('start')}
          onContinue={() => setRoute('shop')}
          onSettings={() => setRoute('settings')}
          onSearch={() => setRoute('search')}
        />
      );
    case 'start':
      return (
        <StartTrip
          testMode={testMode}
          onBack={() => setRoute('home')}
          onStarted={async (id) => {
            await setSetting('activeTripId', String(id));
            setTripId(id);
            setRoute('shop');
          }}
        />
      );
    case 'shop':
      return (
        <Shopping
          tripId={tripId!}
          onFinish={() => setRoute('cashier')}
          onHome={() => setRoute('home')}
          onCancelled={() => {
            setTripId(null);
            setToast(S.shop.cancelled);
            setRoute('home');
          }}
        />
      );
    case 'cashier':
      return (
        <Cashier
          tripId={tripId!}
          testMode={testMode}
          onBack={() => setRoute('shop')}
          onEnded={() => {
            sharePending();
            setTripId(null);
            setToast(S.cashier.thanks);
            setRoute('home');
          }}
        />
      );
    case 'settings':
      return (
        <Settings
          testMode={testMode}
          onTestMode={async (on) => {
            setTestMode(on);
            await setSetting('testMode', on ? '1' : '0');
          }}
          onOcrCheck={() => setRoute('ocrcheck')}
          onResults={() => setRoute('results')}
          onBack={() => setRoute('home')}
        />
      );
    case 'ocrcheck':
      return <OcrCheck onBack={() => setRoute('settings')} />;
    case 'results':
      return <Results onBack={() => setRoute('settings')} />;
    case 'search':
      return <Search onBack={() => setRoute('home')} />;
  }
}
