'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';

const projectDescriptions = [
	{
		title: 'Polar Clock',
		description: 'A real-time clock visualization using polar coordinates. Concentric rings represent seconds, minutes, hours, days, and months.',
		borderColor: 'border-l-chart-1',
	},
	{
		title: "Conway's Game of Life",
		description: 'An interactive cellular automaton simulation with preset patterns, play/pause controls, and a generation counter. Simple rules, complex emergent behavior.',
		borderColor: 'border-l-chart-2',
	},
	{
		title: 'Room Planner',
		description: 'A drag-and-drop layout tool for planning room arrangements. Add furniture with custom dimensions and position items on an inch-precision grid.',
		borderColor: 'border-l-chart-3',
	},
	{
		title: 'BarFoo',
		description: 'A music library browser that reads your local collection, displays album art, and lets you play tracks directly in the browser.',
		borderColor: 'border-l-chart-4',
	},
	{
		title: 'LoL Challenges',
		description: 'Track League of Legends challenge progress across all categories with tier badges, progress bars, percentile rankings, and match history.',
		borderColor: 'border-l-chart-5',
	},
	{
		title: 'Server Dashboard',
		description: 'Monitor system resources, manage systemd services, and view historical metrics with interactive charts for CPU, memory, disk, and network.',
		borderColor: 'border-l-chart-1',
	},
];

const techStack = ['Next.js', 'React', 'TypeScript', 'TailwindCSS', 'PostgreSQL', 'shadcn/ui', 'motion'];

export default function AboutPage() {
	return (
		<PageTransition>
			<div className="bg-background">
				<div className="container mx-auto px-4 py-16 max-w-3xl">
					<FadeIn>
						<div className="flex items-center gap-3 mb-8">
							<h1 className="text-4xl font-bold tracking-tight text-foreground">
								About Devy&apos;s Workshop
							</h1>
							<Badge variant="secondary">Dashboard</Badge>
						</div>
					</FadeIn>

					<div className="space-y-6 text-muted-foreground">
						<FadeIn delay={0.1}>
							<p className="text-lg">
								Devy&apos;s Workshop is a personal server dashboard and creative coding space —
								a home for interactive projects, system monitoring, and experiments in
								web development. Each project explores a different idea, from gaming
								integrations to algorithmic simulations to practical tools.
							</p>
						</FadeIn>

						<FadeIn delay={0.2}>
							<h2 className="text-2xl font-semibold text-foreground pt-4">Projects</h2>
						</FadeIn>

						<div className="space-y-3">
							{projectDescriptions.map((project, i) => (
								<FadeIn key={project.title} delay={0.25 + i * 0.1}>
									<Card className={`border-l-4 ${project.borderColor}`}>
										<CardHeader>
											<CardTitle className="text-lg">{project.title}</CardTitle>
											<CardDescription>{project.description}</CardDescription>
										</CardHeader>
									</Card>
								</FadeIn>
							))}
						</div>

						<FadeIn delay={0.6}>
							<h2 className="text-2xl font-semibold text-foreground pt-4">Tech Stack</h2>
							<div className="flex flex-wrap gap-2 mt-3">
								{techStack.map((tech) => (
									<Badge key={tech} variant="outline">{tech}</Badge>
								))}
							</div>
						</FadeIn>

						<FadeIn delay={0.7}>
							<div className="pt-6">
								<Button asChild>
									<Link href="/projects">View Projects</Link>
								</Button>
							</div>
						</FadeIn>
					</div>
				</div>
			</div>
		</PageTransition>
	);
}
