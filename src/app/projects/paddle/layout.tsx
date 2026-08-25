import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: "The Outfitter — Devy's Workshop",
};

export default function OutfitterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
