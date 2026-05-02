'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from './ThemeProvider';
import { motion, AnimatePresence } from 'motion/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import {
	Sun, Moon, Menu, UserCircle, Music, Wallet, Film, Tv,
	ExternalLink, ChevronRight, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const navLinks = [
	{ href: '/projects', label: 'Projects' },
	{ href: '/about', label: 'About' },
];

interface QuickProject {
	href: string;
	icon: React.ElementType;
	label: string;
	sublabel: string;
	color: string;
	external?: boolean;
}

const Header = () => {
	const { theme, toggleTheme } = useTheme();
	const pathname = usePathname();
	const [mobileOpen, setMobileOpen] = useState(false);
	const [jellyfinUrl, setJellyfinUrl] = useState<string | null>(null);

	// Auto-close the mobile sidebar whenever the route changes.
	useEffect(() => { setMobileOpen(false); }, [pathname]);

	// Build the Jellyfin server URL from whatever hostname the user is hitting,
	// so it works the same whether they came in via tailnet, LAN, or localhost.
	useEffect(() => {
		if (typeof window === 'undefined') return;
		setJellyfinUrl(`${window.location.protocol}//${window.location.hostname}:8096`);
	}, []);

	const isActive = (href: string) => {
		if (href === '/') return pathname === '/';
		return pathname.startsWith(href);
	};

	const quickProjects: QuickProject[] = [
		{ href: '/projects/barfoo',     icon: Music,  label: 'BarFoo',          sublabel: 'Music library',     color: '#a78bfa' },
		{ href: '/projects/splitwiser', icon: Wallet, label: 'SplitWiser',      sublabel: 'Split expenses',    color: '#fbbf24' },
		{ href: '/projects/jellyfin',   icon: Film,   label: 'Jellyfin Fetcher', sublabel: 'Add torrents',     color: '#22d3ee' },
	];

	return (
		<header className="sticky top-0 z-50 w-full bg-background/95 md:bg-background/60 md:backdrop-blur-xl border-b border-border/40">
			<div className="container mx-auto flex h-14 items-center px-4">
				{/* Logo */}
				<Link href="/" className="group flex items-center gap-2.5 mr-8">
					<div className="relative w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-sm shadow-primary/20 group-hover:shadow-primary/40 transition-shadow">
						<span className="text-xs font-black text-primary-foreground tracking-tighter">D</span>
					</div>
					<span className="text-base font-semibold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
						Devy&apos;s Workshop
					</span>
				</Link>

				{/* Desktop nav */}
				<nav className="hidden md:flex items-center gap-0.5">
					{navLinks.map((link) => (
						<Link
							key={link.href}
							href={link.href}
							className="relative px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
						>
							<span className={isActive(link.href) ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}>
								{link.label}
							</span>
							{isActive(link.href) && (
								<motion.div
									layoutId="nav-indicator"
									className="absolute inset-0 rounded-md bg-primary/10 -z-10"
									transition={{ type: 'spring', stiffness: 400, damping: 30 }}
								/>
							)}
						</Link>
					))}
				</nav>

				{/* Right side */}
				<div className="flex flex-1 items-center justify-end gap-1">
					{/* Profile (desktop only — sidebar covers it on mobile) */}
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon" asChild className="hidden md:inline-flex h-8 w-8 rounded-full">
								<Link href="/profile" aria-label="Profile & Settings">
									<UserCircle className={`h-4 w-4 ${isActive('/profile') ? 'text-foreground' : 'text-muted-foreground'}`} />
								</Link>
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">
							<p className="text-xs">Profile &amp; Settings</p>
						</TooltipContent>
					</Tooltip>

					{/* Theme toggle (desktop only — sidebar has a more prominent one on mobile) */}
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								onClick={toggleTheme}
								aria-label="Toggle theme"
								className="hidden md:inline-flex h-8 w-8 rounded-full"
							>
								<AnimatePresence mode="wait" initial={false}>
									{theme === 'light' ? (
										<motion.div
											key="sun"
											initial={{ opacity: 0, scale: 0.5, rotate: -90 }}
											animate={{ opacity: 1, scale: 1, rotate: 0 }}
											exit={{ opacity: 0, scale: 0.5, rotate: 90 }}
											transition={{ duration: 0.2 }}
										>
											<Sun className="h-4 w-4" />
										</motion.div>
									) : (
										<motion.div
											key="moon"
											initial={{ opacity: 0, scale: 0.5, rotate: -90 }}
											animate={{ opacity: 1, scale: 1, rotate: 0 }}
											exit={{ opacity: 0, scale: 0.5, rotate: 90 }}
											transition={{ duration: 0.2 }}
										>
											<Moon className="h-4 w-4" />
										</motion.div>
									)}
								</AnimatePresence>
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">
							<p className="text-xs">{theme === 'light' ? 'Dark' : 'Light'} mode</p>
						</TooltipContent>
					</Tooltip>

					{/* Mobile sidebar — Radix Dialog + motion/react.
					    Custom slide animation (vs. CSS keyframes) so mobile Chrome
					    actually GPU-composites the transform every frame. */}
					<DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
						<DialogPrimitive.Trigger asChild>
							<Button variant="ghost" size="icon" className="md:hidden h-9 w-9 rounded-full" aria-label="Open menu">
								<Menu className="h-5 w-5" />
							</Button>
						</DialogPrimitive.Trigger>
						<AnimatePresence>
							{mobileOpen && (
								<DialogPrimitive.Portal forceMount>
									<DialogPrimitive.Overlay asChild forceMount>
										<motion.div
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0 }}
											transition={{ duration: 0.2, ease: 'easeOut' }}
											className="fixed inset-0 bg-black/50 z-50"
										/>
									</DialogPrimitive.Overlay>
									<DialogPrimitive.Content asChild forceMount>
										<motion.div
											initial={{ x: '100%' }}
											animate={{ x: 0 }}
											exit={{ x: '100%' }}
											transition={{ type: 'spring', stiffness: 360, damping: 36, mass: 0.9 }}
											className="fixed top-0 right-0 bottom-0 z-50 w-[85vw] max-w-sm bg-background shadow-2xl flex flex-col gap-0 outline-none"
											style={{ willChange: 'transform' }}
										>
											<div className="px-5 pt-5 pb-3 border-b border-border/40 flex items-center justify-between">
												<DialogPrimitive.Title className="flex items-center gap-2.5 text-base font-semibold">
													<div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
														<span className="text-xs font-black text-primary-foreground tracking-tighter">D</span>
													</div>
													Devy&apos;s Workshop
												</DialogPrimitive.Title>
												<DialogPrimitive.Close asChild>
													<button
														className="p-1.5 rounded-lg hover:bg-muted/60 active:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
														aria-label="Close menu"
													>
														<X className="h-4 w-4" />
													</button>
												</DialogPrimitive.Close>
											</div>

											<div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
												{/* Quick projects */}
												<section className="space-y-1">
													<div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-2 mb-1.5">
														Quick access
													</div>
													{quickProjects.map((p) => {
														const active = isActive(p.href);
														return (
															<Link
																key={p.href}
																href={p.href}
																onClick={() => setMobileOpen(false)}
																className={`flex items-center gap-3 px-2.5 py-2.5 rounded-xl transition-colors ${
																	active ? 'bg-muted/60' : 'hover:bg-muted/40 active:bg-muted/60'
																}`}
															>
																<div
																	className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
																	style={{ backgroundColor: `${p.color}1f`, boxShadow: active ? `inset 0 0 0 1px ${p.color}40` : 'none' }}
																>
																	<p.icon className="h-5 w-5" style={{ color: p.color }} />
																</div>
																<div className="flex-1 min-w-0">
																	<div className="text-sm font-medium text-foreground truncate">{p.label}</div>
																	<div className="text-[11px] text-muted-foreground truncate">{p.sublabel}</div>
																</div>
																<ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
															</Link>
														);
													})}
													{jellyfinUrl && (
														<a
															href={jellyfinUrl}
															target="_blank"
															rel="noreferrer"
															onClick={() => setMobileOpen(false)}
															className="flex items-center gap-3 px-2.5 py-2.5 rounded-xl hover:bg-muted/40 active:bg-muted/60 transition-colors"
														>
															<div
																className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
																style={{ backgroundColor: '#9333ea1f' }}
															>
																<Tv className="h-5 w-5 text-violet-400" />
															</div>
															<div className="flex-1 min-w-0">
																<div className="text-sm font-medium text-foreground truncate flex items-center gap-1">
																	Jellyfin
																	<ExternalLink className="h-3 w-3 text-muted-foreground/60" />
																</div>
																<div className="text-[11px] text-muted-foreground truncate">Watch shows &amp; movies</div>
															</div>
														</a>
													)}
												</section>

												<Separator className="opacity-60" />

												{/* General nav */}
												<section className="space-y-0.5">
													<div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-2 mb-1.5">
														Workshop
													</div>
													{[...navLinks, { href: '/profile', label: 'Profile & Settings' }].map((link) => {
														const active = isActive(link.href);
														return (
															<Link
																key={link.href}
																href={link.href}
																onClick={() => setMobileOpen(false)}
																className={`block px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${
																	active
																		? 'text-foreground bg-primary/10'
																		: 'text-muted-foreground hover:text-foreground hover:bg-muted/40 active:bg-muted/60'
																}`}
															>
																{link.label}
															</Link>
														);
													})}
												</section>
											</div>

											{/* Theme toggle pinned to bottom */}
											<div className="px-3 pb-4 pt-2 border-t border-border/40">
												<button
													onClick={toggleTheme}
													className="w-full flex items-center justify-between px-3 py-3 rounded-xl bg-muted/40 hover:bg-muted/60 active:bg-muted/80 transition-colors"
												>
													<span className="text-sm font-medium flex items-center gap-2.5">
														{theme === 'light' ? (
															<Sun className="h-4 w-4 text-amber-400" />
														) : (
															<Moon className="h-4 w-4 text-indigo-300" />
														)}
														{theme === 'light' ? 'Light mode' : 'Dark mode'}
													</span>
													<span className="text-[11px] text-muted-foreground">
														switch to {theme === 'light' ? 'dark' : 'light'}
													</span>
												</button>
											</div>
										</motion.div>
									</DialogPrimitive.Content>
								</DialogPrimitive.Portal>
							)}
						</AnimatePresence>
					</DialogPrimitive.Root>
				</div>
			</div>
		</header>
	);
};

export default Header;
