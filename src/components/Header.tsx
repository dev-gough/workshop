'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from './ThemeProvider';
import { motion, AnimatePresence } from 'motion/react';
import { Sun, Moon, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from '@/components/ui/sheet';

const navLinks = [
	{ href: '/projects', label: 'Projects' },
	{ href: '/about', label: 'About' },
];

const Header = () => {
	const { theme, toggleTheme } = useTheme();
	const pathname = usePathname();

	const isActive = (href: string) => {
		if (href === '/') return pathname === '/';
		return pathname.startsWith(href);
	};

	return (
		<header className="sticky top-0 z-50 w-full bg-background/60 backdrop-blur-xl border-b border-border/40">
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
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								onClick={toggleTheme}
								aria-label="Toggle theme"
								className="h-8 w-8 rounded-full"
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

					<Sheet>
						<SheetTrigger asChild>
							<Button variant="ghost" size="icon" className="md:hidden h-8 w-8 rounded-full" aria-label="Open menu">
								<Menu className="h-4 w-4" />
							</Button>
						</SheetTrigger>
						<SheetContent side="right" className="w-64">
							<SheetHeader>
								<SheetTitle>Navigation</SheetTitle>
							</SheetHeader>
							<nav className="flex flex-col gap-1 mt-4">
								{navLinks.map((link) => (
									<Link
										key={link.href}
										href={link.href}
										className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
											isActive(link.href)
												? 'text-foreground bg-primary/10'
												: 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
										}`}
									>
										{link.label}
									</Link>
								))}
								<Separator className="my-2" />
								<Button variant="outline" size="sm" onClick={toggleTheme} className="justify-start">
									{theme === 'light' ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
									{theme === 'light' ? 'Dark' : 'Light'} mode
								</Button>
							</nav>
						</SheetContent>
					</Sheet>
				</div>
			</div>
		</header>
	);
};

export default Header;
