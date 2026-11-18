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
import { Explore, type Tab as ExploreTab } from './screens/Explore';
import { RecipeDetail } from './screens/Recipes';
import { ComingSoon, type SoonFeature } from './screens/ComingSoon';
import { Profile } from './screens/Profile';
import { QuestionFlow } from './components/QuestionFlow';
import { markShown, recordVisit, type QuestionSet } from './lib/visits';
import type { CategoryId } from './lib/categories';
import { Login } from './screens/Login';
import { NoticeBanner } from './components/NoticeBanner';
import { dismissNotice, loadNotices, type Notice } from './lib/notices';
import { LOGIN_REQUIRED, initAuth, onAccountChange, readReturn, savedAccount, type Account } from './lib/auth';

type Route = 'loading' | 'login' | 'explore' | 'home' | 'start' | 'shop' | 'cashier' | 'settings' | 'ocrcheck' | 'results' | 'search' | 'soon' | 'profile' | 'recipe';
/** Screens a back button can return to. */
type Base = 'explore' | 'home';

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
  // Where Search and New trip go back to, and which coming-soon tab is open.
  const [back, setBack] = useState<Base>('explore');
  const [searchCategory, setSearchCategory] = useState<CategoryId | null>(null);
  const [soon, setSoon] = useState<SoonFeature>('community');
  const [notices, setNotices] = useState<Notice[]>([]);
  // The recipe open on the recipe screen, and which Explore tab to come back to.
  const [recipeSlug, setRecipeSlug] = useState<string | null>(null);
  const [exploreTab, setExploreTab] = useState<ExploreTab>('products');
  // Profile questions due on this visit (2nd: about you, 3rd: household). Counted when the app comes to the front.
  const [due, setDue] = useState<{ id: string; set: QuestionSet | null } | null>(null);
  const accountId = account?.id;
  // Bumped when the visit popups close, so the Profile tab underneath shows the new answers.
  const [profileVersion, setProfileVersion] = useState(0);

  useEffect(() => {
    if (!accountId) return;
    const check = () => {
      if (document.visibilityState === 'visible') recordVisit(accountId).then((set) => setDue({ id: accountId, set })).catch(() => undefined);
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [accountId]);

  // Notices from Abaseria (incl. a breach notice): checked on open and whenever the app comes back to the front.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'visible') loadNotices().then(setNotices);
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, []);

  useEffect(() => {
    requestPersistentStorage();
    // Start the OCR engine now so the first tag photo doesn't wait for it.
    warmOcr().catch((e) => console.warn('OCR warm-up failed', e));

    /** Where the app opens once the shopper is signed in: Explore. Reopening mid-trip goes straight back to the list. */
    async function enter() {
      const active = Number(await getSetting('activeTripId'));
      if (active) {
        setTripId(active);
        setRoute('shop');
      } else setRoute('explore');
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

  /** Scan in the bottom bar: back into the trip in progress, or start one. */
  function scan(from: Base) {
    if (tripId) return setRoute('shop');
    setBack(from);
    setRoute('start');
  }
  function search(from: Base, category?: CategoryId) {
    setBack(from);
    setSearchCategory(category ?? null);
    setRoute('search');
  }
  function openSoon(feature: SoonFeature) {
    setSoon(feature);
    setRoute('soon');
  }

  const notice = route === 'loading' ? null : notices[0];
  const banner = notice && (
    <NoticeBanner
      notice={notice}
      onClose={() => {
        void dismissNotice(notice.id);
        setNotices((list) => list.filter((n) => n.id !== notice.id));
      }}
    />
  );
  // Never over a trip, the cashier or sign-in: only where the shopper is browsing.
  const askNow = account && due?.id === account.id && (route === 'explore' || route === 'profile') ? due.set : null;
  const questions = askNow && account && (
    <QuestionFlow
      key={askNow}
      set={askNow}
      suggestedName={account.name}
      onShown={() => void markShown(account.id, askNow)}
      onClose={() => {
        setDue(null);
        setProfileVersion((v) => v + 1);
      }}
    />
  );
  return (
    <>
      {banner}
      {screen()}
      {questions}
    </>
  );

  function screen() {
    switch (route) {
      case 'loading':
        return <main className="screen" />;
      case 'login':
        return <Login key={loginError ?? ''} finishing={finishing} error={loginError} />;
      case 'explore':
        return (
          <Explore
            key={exploreTab}
            initialTab={exploreTab}
            onRecipe={(slug) => {
              setRecipeSlug(slug);
              setExploreTab('recipes');
              setRoute('recipe');
            }}
            activeTripId={tripId}
            onScan={() => scan('explore')}
            onSearch={(category) => search('explore', category)}
            onCart={() => setRoute('home')}
            onCommunity={() => openSoon('community')}
            onProfile={() => setRoute('profile')}
          />
        );
      case 'soon':
        return (
          <ComingSoon
            key={soon}
            feature={soon}
            onExplore={() => {
              setExploreTab('products');
              setRoute('explore');
            }}
            onCart={() => setRoute('home')}
            onScan={() => scan('explore')}
            onCommunity={() => openSoon('community')}
            onProfile={() => setRoute('profile')}
          />
        );
      case 'profile':
        return (
          <Profile
            key={profileVersion}
            account={account}
            onExplore={() => {
              setExploreTab('products');
              setRoute('explore');
            }}
            onCart={() => setRoute('home')}
            onScan={() => scan('explore')}
            onCommunity={() => openSoon('community')}
            onSettings={() => setRoute('settings')}
          />
        );
      case 'home':
        return (
          <Home
            activeTripId={tripId}
            toast={toast}
            onStart={() => scan('home')}
            onContinue={() => setRoute('shop')}
            onSettings={() => setRoute('settings')}
            onSearch={() => search('home')}
            onExplore={() => {
              setExploreTab('products');
              setRoute('explore');
            }}
            onCommunity={() => openSoon('community')}
            onProfile={() => setRoute('profile')}
          />
        );
      case 'start':
        return (
          <StartTrip
            testMode={testMode}
            onBack={() => setRoute(back)}
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
      case 'recipe':
        return <RecipeDetail key={recipeSlug ?? ''} slug={recipeSlug ?? ''} onBack={() => setRoute('explore')} />;
      case 'search':
        return <Search key={searchCategory ?? 'all'} initialCategory={searchCategory} onBack={() => setRoute(back)} />;
    }
  }
}
