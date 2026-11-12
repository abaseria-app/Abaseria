import { describe, expect, it } from 'vitest';
import { chromeIntentUrl, detectInAppBrowser, isAndroid, pageToOpen } from './inAppBrowser';

// Real-world shapes of each app's user agent.
const UA = {
  messengerAndroid:
    'Mozilla/5.0 (Linux; Android 14; 2312DRAABG Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.102 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/485.0.0.68.109;]',
  facebookAndroid:
    'Mozilla/5.0 (Linux; Android 16; 24117RN76G Build/BP2A.250605.031; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.122 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/533.0.0.48.71;]',
  instagramAndroid:
    'Mozilla/5.0 (Linux; Android 13; SM-A145F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.107 Mobile Safari/537.36 Instagram 356.0.0.41.101 Android (33/13; 300dpi; 720x1465; samsung; SM-A145F; a14; mt6769t; en_PH; 657432173)',
  facebookIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/489.0.0.47.106;FBBV/663364337;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]',
  messengerIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LightSpeed [FBAN/MessengerLiteForiOS;FBAV/478.0.0.32.111;FBBV/644826712;FBDV/iPhone14,7;FBMD/iPhone;FBSN/iOS;FBSV/17.6;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/0]',
  chromePoco:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  samsungInternet:
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
};

describe('detectInAppBrowser', () => {
  it('spots Messenger, Facebook and Instagram on Android', () => {
    expect(detectInAppBrowser(UA.messengerAndroid)).toBe('messenger');
    expect(detectInAppBrowser(UA.facebookAndroid)).toBe('facebook');
    expect(detectInAppBrowser(UA.instagramAndroid)).toBe('instagram');
  });
  it('spots them on iPhone too', () => {
    expect(detectInAppBrowser(UA.facebookIphone)).toBe('facebook');
    expect(detectInAppBrowser(UA.messengerIphone)).toBe('messenger');
  });
  it('leaves normal browsers alone', () => {
    expect(detectInAppBrowser(UA.chromePoco)).toBeNull();
    expect(detectInAppBrowser(UA.samsungInternet)).toBeNull();
    expect(detectInAppBrowser(UA.safariIphone)).toBeNull();
    expect(detectInAppBrowser('')).toBeNull();
  });
  it('catches any of the five markers on their own', () => {
    for (const m of ['FB_IAB', 'FBAN', 'FBAV', 'Messenger', 'Instagram']) {
      expect(detectInAppBrowser(`Mozilla/5.0 (Linux; Android 14) ${m}/1`)).not.toBeNull();
    }
  });
});

describe('isAndroid', () => {
  it('tells Android from iPhone', () => {
    expect(isAndroid(UA.messengerAndroid)).toBe(true);
    expect(isAndroid(UA.messengerIphone)).toBe(false);
  });
});

describe('links to Chrome', () => {
  it('opens the same page in Chrome', () => {
    expect(chromeIntentUrl('https://abaseria-app.github.io/Abaseria/dev/')).toBe(
      'intent://abaseria-app.github.io/Abaseria/dev/#Intent;scheme=https;package=com.android.chrome;end',
    );
  });
  it('keeps the query (as ?facebook=, which the app still reads) but drops the #fragment', () => {
    expect(chromeIntentUrl('https://abaseria-app.github.io/Abaseria/?facebook#top')).toBe(
      'intent://abaseria-app.github.io/Abaseria/?facebook=#Intent;scheme=https;package=com.android.chrome;end',
    );
  });
  it('drops sign-in leftovers and the preview switch', () => {
    expect(pageToOpen('https://abaseria-app.github.io/Abaseria/dev/?inapp&error=access_denied&error_description=x')).toBe(
      'https://abaseria-app.github.io/Abaseria/dev/',
    );
  });
});
