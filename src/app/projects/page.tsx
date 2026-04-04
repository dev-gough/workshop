'use client';

import Link from 'next/link';
import { Clock, Grid3X3, Home, Music, Trophy, Server } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import StaggerContainer from '@/components/motion/StaggerContainer';
import { motion } from 'motion/react';

const projects = [
	{
		title: 'Polar Clock',
		description: 'A real-time clock visualization using polar coordinates. Concentric rings represent seconds, minutes, hours, days, and months.',
		href: '/projects/polar-clock',
		tags: ['Canvas', 'Visualization'],
		icon: Clock,
	},
	{
		title: "Conway's Game of Life",
		description: 'An interactive cellular automaton simulation with preset patterns, play/pause controls, and a generation counter.',
		href: '/projects/gol',
		tags: ['Canvas', 'Simulation'],
		icon: Grid3X3,
	},
	{
		title: 'Room Planner',
		description: 'A drag-and-drop layout tool for planning room arrangements. Add furniture with custom dimensions on an inch-precision grid.',
		href: '/projects/house',
		tags: ['Canvas', 'Tool'],
		icon: Home,
	},
	{
		title: 'BarFoo',
		description: 'A music library browser that reads your local collection, displays album art, and lets you play tracks directly in the browser.',
		href: '/projects/barfoo',
		tags: ['Music', 'API'],
		icon: Music,
	},
	{
		title: 'LoL Challenges',
		description: 'Track your League of Legends challenge progress across all categories with tier badges, progress bars, and percentile rankings.',
		href: '/projects/challenges',
		tags: ['Gaming', 'API'],
		icon: Trophy,
	},
	{
		title: 'Server Dashboard',
		description: 'Monitor system resources, manage systemd services, and view real-time logs for all running processes on the workshop server.',
		href: '/projects/server',
		tags: ['System', 'Dashboard'],
		icon: Server,
	},
];

const cardVariants = {
	hidden: { opacity: 0, y: 20 },
	visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as const } },
};

export default function ProjectsPage() {
	return (
		<PageTransition>
			<div className="p-8">
				<div className="container mx-auto max-w-4xl">
					<FadeIn>
						<h1 className="text-3xl font-bold mb-2">Projects</h1>
						<p className="text-muted-foreground mb-8">Interactive experiments and creative tools.</p>
					</FadeIn>

					<StaggerContainer className="grid grid-cols-1 md:grid-cols-2 gap-6">
						{projects.map((project) => (
							<motion.div key={project.title} variants={cardVariants}>
								<motion.div
									whileHover={{ y: -4 }}
									transition={{ type: 'spring', stiffness: 300, damping: 20 }}
								>
									<Card className="h-full border-border hover:border-primary/30 transition-colors">
										<CardHeader>
											<div className="flex items-center gap-3 mb-1">
												<div className="p-2 rounded-md bg-primary/10 text-primary">
													<project.icon className="h-5 w-5" />
												</div>
												<CardTitle>{project.title}</CardTitle>
											</div>
											<CardDescription>{project.description}</CardDescription>
										</CardHeader>
										<CardContent>
											<div className="flex gap-2 flex-wrap">
												{project.tags.map((tag) => (
													<Badge key={tag} variant="secondary">{tag}</Badge>
												))}
											</div>
										</CardContent>
										<CardFooter>
											<Button size="sm" asChild>
												<Link href={project.href}>Open Project</Link>
											</Button>
										</CardFooter>
									</Card>
								</motion.div>
							</motion.div>
						))}
					</StaggerContainer>
				</div>
			</div>
		</PageTransition>
	);
}
