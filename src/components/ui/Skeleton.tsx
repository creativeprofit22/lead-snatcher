'use client';

import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('animate-pulse rounded-md bg-white/10', className)} />;
}

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export function TableSkeleton({ rows = 5, columns = 8 }: TableSkeletonProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr
          key={rowIndex}
          className="border-b border-white/5"
          style={{
            animationDelay: `${rowIndex * 50}ms`,
            animationFillMode: 'backwards',
          }}
        >
          {Array.from({ length: columns }).map((_, colIndex) => (
            <td key={colIndex} className="px-4 py-3">
              <Skeleton
                className={cn('h-4', colIndex === 0 ? 'w-24' : colIndex === 1 ? 'w-48' : 'w-16')}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
