import { useEffect, useRef, useState } from 'react';
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
import { Login } from './screens/Login';
import { LOGIN_REQUIRED, initAuth, onAccountChange, readReturn, savedAccount, type Account } from './lib/auth';

type Route = 'loading' | 'login' | 'home' | 'start' | 'shop' | 'cashier' | 'settings' | 'ocrcheck' | 'results' | 'search';

export default function App() {
  const [route, setRoute] = useState<Route>('loading');
  const routeRef = useRef(route);
  useEffect(() => {
    routeRef.current = route;
  }, [route]);
  const [tripId, setTripId] = useState<number | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    requestPersistentStorage();
    // Start the OCR engine now so the first tag photo doesn't wait for it.
    warmOcr().catch((e) => console.warn('OCR warm-up failed', e));

    /** Where the app opens once the shopper is signed in. Reopening mid-trip goes straight back to the list. */
    async function enter() {
      const active = Number(await getSetting('activeTripId'));
      if (active) {
        setTripId(active);
        setRoute('shop');
      } else setRoute('home');
    }

    const stop = onAccountChange((a) => {
      setAccount(a);
      if (!a) setRoute('login');
      else {
        if (routeRef.current === 'login') void enter();
        sharePending();
      }
    });

    (async () => {
      setTestMode((await getSetting('testMode')) === '1');
      if (!LOGIN_REQUIRED) {
        startSharing();
        return enter();
      }
      // The phone's record opens the app at once, even offline; Supabase checks it in the background.
      const saved = await savedAccount();
      const back = readReturn(window.location.href);
      if (saved && !back.finishing) {
        setAccount(saved);
        await enter();
      } else {
        setFinishing(back.finishing);
        setRoute('login');
      }
      const r = await initAuth();
      setFinishing(false);
      setAccount(r.account);
      if (r.redirecting) return setFinishing(true);
      if (!r.account) {
        setLoginError(r.error);
        return setRoute('login');
      }
      // Uploads finished trips that didn't make it last time (dev app only for now).
      startSharing();
      if (!saved || back.finishing) await enter();
    })();
    return stop;
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  switch (route) {
    case 'loading':
      return <main className="screen" />;
    case 'login':
      return <Login key={loginError ?? ''} finishing={finishing} error={loginError} />;
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
          account={account}
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
