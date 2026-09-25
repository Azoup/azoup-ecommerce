import { useEffect, useState } from 'react';

export function useResponsiveLayout() {
  const [width, setWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1200,
  );

  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return {
    width,
    isPhone: width < 480,
    isMobile: width < 768,
    isMobileNav: width < 1024,
    isDesktop: width >= 1024,
  };
}
