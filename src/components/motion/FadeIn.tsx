'use client';
import { motion } from 'motion/react';

interface FadeInProps {
	children: React.ReactNode;
	delay?: number;
	direction?: 'up' | 'down' | 'left' | 'right';
	className?: string;
}

const directionMap = {
	up: { y: 20 },
	down: { y: -20 },
	left: { x: 20 },
	right: { x: -20 },
};

export default function FadeIn({ children, delay = 0, direction = 'up', className }: FadeInProps) {
	return (
		<motion.div
			initial={{ opacity: 0, ...directionMap[direction] }}
			animate={{ opacity: 1, x: 0, y: 0 }}
			transition={{ duration: 0.5, delay, ease: [0.25, 0.1, 0.25, 1] }}
			className={className}
		>
			{children}
		</motion.div>
	);
}
