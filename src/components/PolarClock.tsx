'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from './ThemeProvider';

interface PolarClockProps {
  width: number;
  height: number;
}

const PolarClock = ({ width, height }: PolarClockProps) => {
  const { theme } = useTheme();
  const [time, setTime] = useState(new Date());
  const [hovered, setHovered] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) / 2 - 20;
  const ringThickness = maxRadius / 5;

  const seconds = time.getSeconds();
  const minutes = time.getMinutes();
  const hours = time.getHours();
  const days = time.getDate();
  const months = time.getMonth() + 1;

  const daysInMonth = new Date(time.getFullYear(), time.getMonth() + 1, 0).getDate();

  // Use chart colors from theme
  const ringColors = theme === 'dark'
    ? ['hsl(225,70%,65%)', 'hsl(172,66%,40%)', 'hsl(350,80%,65%)', 'hsl(45,93%,58%)', 'hsl(280,65%,65%)']
    : ['hsl(225,65%,40%)', 'hsl(172,66%,50%)', 'hsl(350,80%,60%)', 'hsl(45,93%,58%)', 'hsl(280,65%,60%)'];

  const bgRingColor = theme === 'dark' ? 'hsl(224,25%,18%)' : 'hsl(220,13%,91%)';
  const centerDotColor = theme === 'dark' ? 'hsl(210,20%,98%)' : 'hsl(224,71%,4%)';

  const rings = [
    { label: 'Months', radius: maxRadius, percentage: (months / 12) * 100, color: ringColors[0] },
    { label: 'Days', radius: maxRadius - ringThickness, percentage: (days / daysInMonth) * 100, color: ringColors[1] },
    { label: 'Hours', radius: maxRadius - 2 * ringThickness, percentage: (hours / 24) * 100, color: ringColors[2] },
    { label: 'Minutes', radius: maxRadius - 3 * ringThickness, percentage: (minutes / 60) * 100, color: ringColors[3] },
    { label: 'Seconds', radius: maxRadius - 4 * ringThickness, percentage: (seconds / 60) * 100, color: ringColors[4] },
  ];

  const getValue = (label: string) => {
    switch (label) {
      case 'Seconds': return `${seconds} / 60`;
      case 'Minutes': return `${minutes} / 60`;
      case 'Hours': return `${hours} / 24`;
      case 'Days': return `${days} / ${daysInMonth}`;
      case 'Months': return `${months} / 12`;
      default: return '';
    }
  };

  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={(e) => {
          if (ref.current) {
            const rect = ref.current.getBoundingClientRect();
            setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          }
        }}
        onMouseLeave={() => setMousePos(null)}
      >
        {rings.map((ring) => {
          const circumference = 2 * Math.PI * ring.radius;
          return (
            <g key={ring.label} onMouseEnter={() => setHovered(ring.label)} onMouseLeave={() => setHovered(null)}>
              <circle
                cx={centerX}
                cy={centerY}
                r={ring.radius}
                fill="none"
                stroke={bgRingColor}
                strokeWidth={ringThickness}
                transform={`rotate(-90 ${centerX} ${centerY})`}
              />
              <circle
                cx={centerX}
                cy={centerY}
                r={ring.radius}
                fill="none"
                stroke={ring.color}
                strokeWidth={ringThickness}
                strokeDasharray={`${circumference * (ring.percentage / 100)} ${circumference * (1 - ring.percentage / 100)}`}
                transform={`rotate(-90 ${centerX} ${centerY})`}
                opacity={0.8}
              />
            </g>
          );
        })}
        <circle cx={centerX} cy={centerY} r={5} fill={centerDotColor} />
      </svg>
      {hovered && mousePos && (
        <div
          style={{ left: mousePos.x + 10, top: mousePos.y - 10, position: 'absolute' }}
          className="bg-popover text-popover-foreground border shadow-md p-2 rounded text-sm z-10 pointer-events-none"
        >
          {hovered}: {getValue(hovered)}
        </div>
      )}
    </div>
  );
};

export default PolarClock;
