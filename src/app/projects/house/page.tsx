'use client';

import HousePlanner from '@/components/HousePlanner';
import PageTransition from '@/components/motion/PageTransition';

export default function HousePage() {
	return (
		<PageTransition>
			<div className="p-8">
				<h1 className="text-3xl font-bold mb-4">Room Planner</h1>
				<p className="text-muted-foreground mb-8">
					Plan your room layout by adding furniture items and arranging them on the grid.
				</p>
				<HousePlanner />
			</div>
		</PageTransition>
	);
}
