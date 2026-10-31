import { useEffect, useState } from 'react';
import { getSetting, requestPersistentStorage, setSetting } from './lib/db';
import { warmOcr } from './lib/ocr';
import { S } from './strings';
import { StartTrip } from './screens/StartTrip';
import { Shopping } from './screens/Shopping';
import { Cashier } from './screens/Cashier';
import { Settings } from './screens/Settings';
import { OcrCheck } from './screens/OcrCheck';
import { Results } from './screens/Results';

type Route = 'loading' | 'start' | 'shop' | 'cashier' | 'settings' | 'ocrcheck' | 'results';

export default function App() {
  const [route, setRoute] = useState<Route>('loading');
  const [tripId, setTripId] = useState<number | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    requestPersistentStorage();
    // Start the OCR engine now so the first tag photo doesn't wait for it.
    warmOcr().catch((e) => console.warn('OCR warm-up failed', e));
    (async () => {
      setTestMode((await getSetting('testMode')) === '1');
      const active = Number(await getSetting('activeTripId'));
      if (active) {
        setTripId(active);
        setRoute('shop');
      } else setRoute('start');
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
    case 'start':
      return (
        <StartTrip
          testMode={testMode}
          toast={toast}
          onSettings={() => setRoute('settings')}
          onStarted={async (id) => {
            await setSetting('activeTripId', String(id));
            setTripId(id);
            setRoute('shop');
          }}
        />
      );
    case 'shop':
      return <Shopping tripId={tripId!} onFinish={() => setRoute('cashier')} />;
    case 'cashier':
      return (
        <Cashier
          tripId={tripId!}
          onBack={() => setRoute('shop')}
          onEnded={() => {
            setTripId(null);
            setToast(S.cashier.thanks);
            setRoute('start');
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
          onBack={() => setRoute('start')}
        />
      );
    case 'ocrcheck':
      return <OcrCheck onBack={() => setRoute('settings')} />;
    case 'results':
      return <Results onBack={() => setRoute('settings')} />;
  }
}
