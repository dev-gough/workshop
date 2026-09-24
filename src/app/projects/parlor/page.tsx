'use client';

import { Suspense } from 'react';
import ParlorApp from './_components/parlor-app';

export default function ParlorPage() {
  return (
    <Suspense fallback={null}>
      <ParlorApp />
    </Suspense>
  );
}
