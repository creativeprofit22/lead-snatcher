'use client';

import { useEffect, useMemo, useState } from 'react';
import Particles, { initParticlesEngine } from '@tsparticles/react';
import { loadSlim } from '@tsparticles/slim';
import type { ISourceOptions } from '@tsparticles/engine';

export function AmbientParticles() {
  const [init, setInit] = useState(false);

  useEffect(() => {
    initParticlesEngine(async (engine) => {
      await loadSlim(engine);
    }).then(() => {
      setInit(true);
    });
  }, []);

  const options = useMemo<ISourceOptions>(
    () => ({
      background: { color: { value: 'transparent' } },
      fpsLimit: 60,
      particles: {
        number: { value: 42, density: { enable: true, width: 1000, height: 1000 } },
        color: { value: '#34d399' },
        opacity: { value: { min: 0.08, max: 0.28 } },
        size: { value: { min: 0.8, max: 2 } },
        move: {
          enable: true,
          speed: 0.35,
          direction: 'none',
          random: true,
          straight: false,
          outModes: { default: 'out' },
        },
        links: {
          enable: true,
          distance: 140,
          color: '#34d399',
          opacity: 0.1,
          width: 1,
        },
      },
      interactivity: {
        events: { onHover: { enable: true, mode: 'grab' } },
        modes: { grab: { distance: 140, links: { opacity: 0.25 } } },
      },
      detectRetina: true,
    }),
    []
  );

  if (!init) return null;

  return (
    <Particles
      id="ambient-particles"
      options={options}
      className="pointer-events-none fixed inset-0 -z-10"
    />
  );
}
