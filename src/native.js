// Android-only touches: dark status bar and the hardware back button.
import { Capacitor } from '@capacitor/core';

export async function initNative() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0f1110' });
  } catch (e) {
    /* plugin missing */
  }
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('backButton', () => {
      const close = document.querySelector('[data-back]');
      if (close) close.click();
      else App.minimizeApp();
    });
  } catch (e) {
    /* plugin missing */
  }
}
