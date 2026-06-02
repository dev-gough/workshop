import type { Metadata } from "next";
import { Geist, Geist_Mono, JetBrains_Mono, Fraunces, Jost } from "next/font/google";
import "./globals.css";
import Header from "../components/Header";
import ThemeProvider from "../components/ThemeProvider";
import ThemeScript from "../components/ThemeScript";
import { HeaderConfigProvider } from "../components/header-config";
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

// Wealthsimple scope: geometric sans (Futura analog) for UI + numbers.
const jost = Jost({
	variable: "--font-ws-sans",
	subsets: ["latin"],
	weight: ["400", "500", "600", "700"],
});

// Wealthsimple scope: chunky roman serif accent (Caslon Graphique analog).
const wsSerif = Fraunces({
	variable: "--font-ws-serif",
	subsets: ["latin"],
	weight: "variable",
	style: ["normal"],
	axes: ["SOFT", "WONK"],
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
				className={`${geistSans.variable} ${geistMono.variable} ${jetbrainsMono.variable} ${fraunces.variable} ${jost.variable} ${wsSerif.variable} antialiased`}
			>
				<ThemeProvider>
					<TooltipProvider>
						<AudioProvider>
							<HeaderConfigProvider>
								<Header />
								<main>
									{children}
								</main>
							</HeaderConfigProvider>
							<FloatingPlayer />
						</AudioProvider>
					</TooltipProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
