'use client';

import HousePlanner from '@/components/HousePlanner';
import PageTransition from '@/components/motion/PageTransition';

export default function HousePage() {
	return (
		<PageTransition>
			<div className="p-6">
				<div className="mb-4">
					<h1 className="text-2xl font-bold">Room Planner</h1>
					<p className="text-sm text-muted-foreground mt-1">
						Design room layouts with furniture from the library or create custom pieces. Drag, rotate, and lock items into place.
					</p>
				</div>
				<HousePlanner />
			</div>
		</PageTransition>
	);
}
