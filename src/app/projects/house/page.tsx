'use client';

import PageTransition from '@/components/motion/PageTransition';
import { useHeaderConfig } from '@/components/header-config';
import RoomPlanner from '@/components/house/RoomPlanner';

export default function HousePage() {
	useHeaderConfig({ scopeClass: 'bp-theme' });

	return (
		<div className="bp-theme">
			<PageTransition>
				<div className="bp-board flex flex-col gap-2 p-3 sm:p-4">
					{/* Board header — a pencilled sheet title, not a web h1 */}
					<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<h1 className="bp-etch !text-xs" style={{ color: 'var(--bp-ink)' }}>
							The Drafting Room
						</h1>
						<p className="text-[11px] text-muted-foreground">
							Measure your furniture once, draw the room, see what fits.
						</p>
					</div>
					<RoomPlanner />
				</div>
			</PageTransition>
		</div>
	);
}
