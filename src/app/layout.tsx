import type { Metadata } from "next";
import { Geist, Geist_Mono, JetBrains_Mono, Fraunces } from "next/font/google";
import "./globals.css";
import Header from "../components/Header";
import ThemeProvider from "../components/ThemeProvider";
import ThemeScript from "../components/ThemeScript";
import AudioProvider from "../components/AudioProvider";
import FloatingPlayer from "../components/FloatingPlayer";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

// Display readout font for /server dashboard numerics (tabular, distinct).
const jetbrainsMono = JetBrains_Mono({
	variable: "--font-readout",
	subsets: ["latin"],
	weight: ["400", "500", "600"],
});

// Editorial accent for the /server page heading — used sparingly.
const fraunces = Fraunces({
	variable: "--font-display",
	subsets: ["latin"],
	weight: "variable",
	style: ["italic"],
	axes: ["SOFT"],
});

export const metadata: Metadata = {
	title: "Devy's Workshop",
	description: "A personal server dashboard and creative coding workshop.",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<ThemeScript />
			</head>
			<body
				className={`${geistSans.variable} ${geistMono.variable} ${jetbrainsMono.variable} ${fraunces.variable} antialiased`}
			>
				<ThemeProvider>
					<TooltipProvider>
						<AudioProvider>
							<Header />
							<main>
								{children}
							</main>
							<FloatingPlayer />
						</AudioProvider>
					</TooltipProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
