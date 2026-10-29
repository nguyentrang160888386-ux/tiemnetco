import { installFirebaseBridge } from './firebase';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = (err) => reject(err);
    document.body.appendChild(script);
  });
}

async function bootGame() {
  try {
    installFirebaseBridge();
  } catch (err) {
    console.error('Firebase bridge init error:', err);
  }

  await loadScript('/js/app-c8e81d3a36b593f3.js?v=2');
  loadScript('/js/quiz-v9.js?v=10').catch(() => {});
  loadScript('/js/draw-v4.js?v=5').catch(() => {});
}

bootGame();
