import { useEffect, useState, type TouchEvent } from 'react';
import { isMobilePlatform, PLATFORM_EVENT } from '@/lib/platform';

interface DeviceState {
  isMobile: boolean;
  isTablet: boolean;
  orientation: 'portrait' | 'landscape';
}

function detectDevice(): DeviceState {
  if (typeof window === 'undefined') {
    return { isMobile: false, isTablet: false, orientation: 'landscape' };
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  const ua = navigator.userAgent || '';
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(ua);
  const mobilePlatform = isMobilePlatform();
  const isMobile = mobilePlatform || width < 768 || mobileUA;

  return {
    isMobile,
    isTablet: !mobilePlatform && !mobileUA && width >= 768 && width < 1024,
    orientation: width > height ? 'landscape' : 'portrait',
  };
}

/**
 * Responsive shell detector.
 *
 * Real mobile platforms always use the mobile shell, even in landscape.
 * Narrow desktop windows also switch to mobile for a usable layout.
 */
export function useMobile() {
  const [state, setState] = useState<DeviceState>(() => {
    const initial = detectDevice();
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('app-mobile', initial.isMobile);
    }
    return initial;
  });

  useEffect(() => {
    const check = () => {
      const next = detectDevice();
      setState(next);
      document.documentElement.classList.toggle('app-mobile', next.isMobile);
    };

    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    window.addEventListener(PLATFORM_EVENT, check);

    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
      window.removeEventListener(PLATFORM_EVENT, check);
    };
  }, []);

  return {
    ...state,
    isDesktop: !state.isMobile && !state.isTablet,
    isLandscape: state.orientation === 'landscape',
    isPortrait: state.orientation === 'portrait',
  };
}

/** Minimal horizontal swipe detector for list rows / sheets. */
export function useTouch() {
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const minSwipeDistance = 50;

  return {
    onTouchStart: (event: TouchEvent) => {
      setTouchEnd(null);
      setTouchStart(event.targetTouches[0].clientX);
    },
    onTouchMove: (event: TouchEvent) => {
      setTouchEnd(event.targetTouches[0].clientX);
    },
    onTouchEnd: () => {
      if (touchStart === null || touchEnd === null) return;
      const distance = touchStart - touchEnd;
      return {
        isLeftSwipe: distance > minSwipeDistance,
        isRightSwipe: distance < -minSwipeDistance,
        distance,
      };
    },
  };
}