// Chrome keeps moving its "install" menu item. This puts an Install button in the app itself:
// Chrome fires `beforeinstallprompt` when the page can be installed, and calling prompt()
// opens the same install dialog the menu would.

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const runningInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  // iOS Safari's own flag
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function setupInstallButton(label: string) {
  if (runningInstalled()) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'install-button';
  button.textContent = label;
  button.hidden = true;
  document.body.append(button);

  let deferred: InstallPromptEvent | null = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // skip Chrome's own mini-banner; our button does the asking
    deferred = e as InstallPromptEvent;
    button.hidden = false;
  });

  button.addEventListener('click', async () => {
    if (!deferred) return;
    const prompt = deferred;
    deferred = null; // each event can only prompt once
    await prompt.prompt();
    await prompt.userChoice;
    button.hidden = true;
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    button.hidden = true;
  });
}
