'use client';

/**
 * HoloCard — holographic shine + cursor spotlight overlay wrapper.
 *
 * Ports two effects from DavidHDev/react-bits (MIT + Commons Clause):
 *  - GlareHover: diagonal shine sweep on hover
 *  - SpotlightCard: radial gradient that follows the cursor
 *
 * https://github.com/DavidHDev/react-bits
 */

import React, { useRef, useState } from 'react';

interface HoloCardProps {
  children: React.ReactNode;
  className?: string;
  spotlightColor?: `rgba(${number}, ${number}, ${number}, ${number})`;
  glareColor?: string;
  glareOpacity?: number;
  glareAngle?: number;
  glareSize?: number;
  transitionDuration?: number;
}

export function HoloCard({
  children,
  className = '',
  spotlightColor = 'rgba(120, 220, 255, 0.28)',
  glareColor = '#9be8ff',
  glareOpacity = 0.32,
  glareAngle = -45,
  glareSize = 250,
  transitionDuration = 720,
}: HoloCardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);
  const [spotPos, setSpotPos] = useState({ x: 0, y: 0 });
  const [spotOpacity, setSpotOpacity] = useState(0);

  const hex = glareColor.startsWith('#') ? glareColor.slice(1) : glareColor;
  let glareRgba = `rgba(155, 232, 255, ${glareOpacity})`;
  if (/^[\dA-Fa-f]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    glareRgba = `rgba(${r}, ${g}, ${b}, ${glareOpacity})`;
  } else if (/^[\dA-Fa-f]{3}$/.test(hex)) {
    const [rHex = '0', gHex = '0', bHex = '0'] = hex;
    const r = parseInt(rHex + rHex, 16);
    const g = parseInt(gHex + gHex, 16);
    const b = parseInt(bHex + bHex, 16);
    glareRgba = `rgba(${r}, ${g}, ${b}, ${glareOpacity})`;
  }

  const handleMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    setSpotPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleEnter = () => {
    setSpotOpacity(1);
    const el = glareRef.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.backgroundPosition = '-100% -100%, 0 0';
    void el.offsetHeight;
    el.style.transition = `${transitionDuration}ms ease`;
    el.style.backgroundPosition = '100% 100%, 0 0';
  };

  const handleLeave = () => {
    setSpotOpacity(0);
    const el = glareRef.current;
    if (!el) return;
    el.style.transition = `${transitionDuration}ms ease`;
    el.style.backgroundPosition = '-100% -100%, 0 0';
  };

  return (
    <div
      ref={rootRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className={`relative overflow-hidden ${className}`}
    >
      {children}

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-500 ease-in-out"
        style={{
          opacity: spotOpacity,
          background: `radial-gradient(circle at ${spotPos.x}px ${spotPos.y}px, ${spotlightColor}, transparent 60%)`,
          mixBlendMode: 'plus-lighter',
        }}
      />

      <div
        ref={glareRef}
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(${glareAngle}deg, hsla(0,0%,0%,0) 60%, ${glareRgba} 70%, hsla(0,0%,0%,0) 100%)`,
          backgroundSize: `${glareSize}% ${glareSize}%, 100% 100%`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: '-100% -100%, 0 0',
          mixBlendMode: 'plus-lighter',
        }}
      />
    </div>
  );
}
