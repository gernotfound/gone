import './smartphone.css';

type UaDataLike = { mobile?: boolean };
type NavigatorWithUaData = Navigator & { userAgentData?: UaDataLike };

type SmartphoneSnapshot = {
  enabled: boolean;
  touchPoints: number;
  coarsePointer: boolean;
  shortestSide: number;
  phoneUa: boolean;
  tabletLike: boolean;
  standalone: boolean;
};

function standaloneMode(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function viewportShortestSide(): number {
  const viewportShort = Math.min(window.innerWidth || Number.POSITIVE_INFINITY, window.innerHeight || Number.POSITIVE_INFINITY);
  const screenShort = Math.min(screen.width || Number.POSITIVE_INFINITY, screen.height || Number.POSITIVE_INFINITY);
  return Math.min(viewportShort, screenShort);
}

function tabletLikeDevice(): boolean {
  const ua = navigator.userAgent;
  const ipadDesktopMode = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const androidTablet = /Android/i.test(ua) && !/Mobile/i.test(ua);
  return ipadDesktopMode || /iPad|Tablet|Silk/i.test(ua) || androidTablet;
}

function phoneUserAgent(): boolean {
  const uaDataMobile = (navigator as NavigatorWithUaData).userAgentData?.mobile;
  if (uaDataMobile === true) return true;
  return /iPhone|iPod|Android.+Mobile|Windows Phone|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function isSmartphoneDevice(): boolean {
  if (navigator.maxTouchPoints <= 0) return false;

  const uaDataMobile = (navigator as NavigatorWithUaData).userAgentData?.mobile;
  if (uaDataMobile === true) return true;
  if (tabletLikeDevice()) return false;

  const coarsePointer = window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: coarse)').matches;
  if (!coarsePointer) return false;

  // 720 CSS px keeps normal phones/foldables in the smartphone profile while
  // avoiding iPad-class/tablet layouts. UA hints are used only as a strong
  // signal; viewport geometry is the fallback so the UI still works when UA
  // reduction hides model details.
  return phoneUserAgent() || viewportShortestSide() <= 720;
}

function snapshot(): SmartphoneSnapshot {
  return {
    enabled: isSmartphoneDevice(),
    touchPoints: navigator.maxTouchPoints,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: coarse)').matches,
    shortestSide: viewportShortestSide(),
    phoneUa: phoneUserAgent(),
    tabletLike: tabletLikeDevice(),
    standalone: standaloneMode(),
  };
}

function applyProfile(): void {
  const state = snapshot();
  const html = document.documentElement;
  html.classList.toggle('gone-smartphone', state.enabled);
  html.dataset.goneDevice = state.enabled ? 'smartphone' : (state.touchPoints > 0 ? 'touch' : 'desktop');
  document.body?.classList.toggle('gone-smartphone-body', state.enabled);
  (window as any).goneDeviceProfile = { ...state, snapshot };
}

export function startSmartphoneProfile(): void {
  if ((window as any).__goneSmartphoneProfileStarted) return;
  (window as any).__goneSmartphoneProfileStarted = true;

  applyProfile();

  let resizeFrame = 0;
  const scheduleRefresh = () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(applyProfile);
  };

  window.addEventListener('resize', scheduleRefresh, { passive: true });
  window.addEventListener('orientationchange', scheduleRefresh, { passive: true });
  window.matchMedia('(pointer: coarse)').addEventListener?.('change', scheduleRefresh);
  window.matchMedia('(any-pointer: coarse)').addEventListener?.('change', scheduleRefresh);
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', scheduleRefresh);
}
