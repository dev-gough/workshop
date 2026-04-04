'use client';
import { motion } from 'motion/react';

export default function StaggerContainer({ children, className }: { children: React.ReactNode; className?: string }) {
	return (
		<motion.div
			initial="hidden"
			animate="visible"
			variants={{
				hidden: {},
				visible: { transition: { staggerChildren: 0.1 } },
			}}
			className={className}
		>
			{children}
		</motion.div>
	);
}
