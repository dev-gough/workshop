'use client';

import { useState, useRef, useEffect } from 'react';
import { useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Item {
	id: number;
	label: string;
	width: number;
	height: number;
	x: number;
	y: number;
}

// Fixed scale: 1 cell = 1 inch
const SCALE_VALUE = 1; // 1 inch per cell
const SCALE_UNIT = 'in';

interface SavedLayout {
	name: string;
	items: Item[];
	nextId: number;
	roomWidth: number;
	roomHeight: number;
}

const STORAGE_KEY = 'houseplanner-layouts';

function loadLayouts(): SavedLayout[] {
	if (typeof window === 'undefined') return [];
	try {
		const data = localStorage.getItem(STORAGE_KEY);
		return data ? JSON.parse(data) : [];
	} catch {
		return [];
	}
}

function saveLayouts(layouts: SavedLayout[]) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
}

export default function HousePlanner() {
	const [items, setItems] = useState<Item[]>([]);
	const [nextId, setNextId] = useState(1);
	const [label, setLabel] = useState('');
	const [width, setWidth] = useState(1);
	const [height, setHeight] = useState(1);
	const [roomWidth, setRoomWidth] = useState(20);
	const [roomHeight, setRoomHeight] = useState(20);
	const [dragging, setDragging] = useState<Item | null>(null);
	const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const { theme } = useTheme();
	const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>([]);
	const [layoutName, setLayoutName] = useState('');

	useEffect(() => {
		setSavedLayouts(loadLayouts());
	}, []);

	const handleSave = () => {
		const name = layoutName.trim() || `Layout ${savedLayouts.length + 1}`;
		const layout: SavedLayout = { name, items, nextId, roomWidth, roomHeight };
		const existing = savedLayouts.findIndex(l => l.name === name);
		let updated: SavedLayout[];
		if (existing >= 0) {
			updated = [...savedLayouts];
			updated[existing] = layout;
		} else {
			updated = [...savedLayouts, layout];
		}
		saveLayouts(updated);
		setSavedLayouts(updated);
		setLayoutName('');
	};

	const handleLoad = (layout: SavedLayout) => {
		setItems(layout.items);
		setNextId(layout.nextId);
		setRoomWidth(layout.roomWidth);
		setRoomHeight(layout.roomHeight);
	};

	const handleDelete = (name: string) => {
		const updated = savedLayouts.filter(l => l.name !== name);
		saveLayouts(updated);
		setSavedLayouts(updated);
	};

	// Grid size in inches (room size in feet * 12)
	const gridSizeX = roomWidth * 12;
	const gridSizeY = roomHeight * 12;

	const addItem = () => {
		if (label.trim()) {
			const newItem: Item = {
				id: nextId,
				label,
				width: Math.max(1, width),
				height: Math.max(1, height),
				x: 0,
				y: 0,
			};
			setItems([...items, newItem]);
			setNextId(nextId + 1);
			setLabel('');
			setWidth(1);
			setHeight(1);
		}
	};

	const draw = () => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		const cellWidth = canvas.width / gridSizeX;
		const cellHeight = canvas.height / gridSizeY;

		// Theme-aware grid colors
		const gridMajor = theme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
		const gridMinor = theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
		const itemColor = theme === 'dark' ? 'hsl(225,70%,65%)' : 'hsl(225,65%,40%)';

		// draw grid lines
		for (let i = 0; i <= gridSizeX; i++) {
			ctx.strokeStyle = i % 5 === 0 ? gridMajor : gridMinor;
			ctx.lineWidth = i % 5 === 0 ? 2 : 1;
			ctx.beginPath();
			ctx.moveTo(i * cellWidth, 0);
			ctx.lineTo(i * cellWidth, canvas.height);
			ctx.stroke();
		}
		for (let i = 0; i <= gridSizeY; i++) {
			ctx.strokeStyle = i % 5 === 0 ? gridMajor : gridMinor;
			ctx.lineWidth = i % 5 === 0 ? 2 : 1;
			ctx.beginPath();
			ctx.moveTo(0, i * cellHeight);
			ctx.lineTo(canvas.width, i * cellHeight);
			ctx.stroke();
		}
		// draw items
		items.forEach(item => {
			ctx.fillStyle = itemColor;
			ctx.fillRect(item.x * cellWidth, item.y * cellHeight, item.width * cellWidth, item.height * cellHeight);
			ctx.fillStyle = 'white';
			ctx.font = '16px sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText(item.label, item.x * cellWidth + item.width * cellWidth / 2, item.y * cellHeight + item.height * cellHeight / 2 + 6);
			ctx.fillText(`${item.width}×${item.height}`, item.x * cellWidth + item.width * cellWidth / 2, item.y * cellHeight + item.height * cellHeight / 2 + 22);
		});
	};

	useEffect(() => {
		draw();
	}, [items, gridSizeX, gridSizeY, theme]);

	const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const scaleX = canvas.width / rect.width;
		const scaleY = canvas.height / rect.height;
		const x = (e.clientX - rect.left) * scaleX;
		const y = (e.clientY - rect.top) * scaleY;
		const cellWidth = canvas.width / gridSizeX;
		const cellHeight = canvas.height / gridSizeY;
		const item = items.find(item => x >= item.x * cellWidth && x < (item.x + item.width) * cellWidth && y >= item.y * cellHeight && y < (item.y + item.height) * cellHeight);
		if (item) {
			setDragging(item);
			setDragOffset({
				x: x - item.x * cellWidth,
				y: y - item.y * cellHeight,
			});
		}
	};

	const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
		if (!dragging || !canvasRef.current) return;
		const canvas = canvasRef.current;
		const rect = canvas.getBoundingClientRect();
		const scaleX = canvas.width / rect.width;
		const scaleY = canvas.height / rect.height;
		const x = (e.clientX - rect.left) * scaleX;
		const y = (e.clientY - rect.top) * scaleY;
		const cellWidth = canvas.width / gridSizeX;
		const cellHeight = canvas.height / gridSizeY;
		const newX = Math.floor((x - dragOffset.x) / cellWidth);
		const newY = Math.floor((y - dragOffset.y) / cellHeight);
		const clampedX = Math.max(0, Math.min(gridSizeX - dragging.width, newX));
		const clampedY = Math.max(0, Math.min(gridSizeY - dragging.height, newY));
		setItems(items.map(item =>
			item.id === dragging.id ? { ...item, x: clampedX, y: clampedY } : item
		));
	};

	const handleMouseUp = () => {
		setDragging(null);
	};

	return (
		<div className="flex flex-col gap-2">
			{/* Controls - Single Row */}
			<div className="flex flex-wrap items-end gap-3 p-2 bg-card rounded border border-border">
				<div className="flex items-center gap-1">
					<Label htmlFor="roomWidth" className="text-xs font-medium">Room:</Label>
					<Input
						id="roomWidth"
						type="number"
						min="1"
						value={roomWidth}
						onChange={(e) => setRoomWidth(Number(e.target.value))}
						className="w-12 h-6 text-xs px-1"
						placeholder="W"
					/>
					<span className="text-xs">×</span>
					<Input
						id="roomHeight"
						type="number"
						min="1"
						value={roomHeight}
						onChange={(e) => setRoomHeight(Number(e.target.value))}
						className="w-12 h-6 text-xs px-1"
						placeholder="H"
					/>
					<span className="text-xs">ft</span>
				</div>

				<div className="flex items-center gap-1">
					<Label htmlFor="label" className="text-xs font-medium">Item:</Label>
					<Input
						id="label"
						value={label}
						onChange={(e) => setLabel(e.target.value)}
						className="w-24 h-6 text-xs px-1"
						placeholder="Name"
					/>
				</div>

				<div className="flex items-center gap-1">
					<Label htmlFor="width" className="text-xs font-medium">Size:</Label>
					<Input
						id="width"
						type="number"
						min="1"
						max={gridSizeX}
						value={width}
						onChange={(e) => setWidth(Number(e.target.value))}
						className="w-16 h-6 text-xs px-1"
						placeholder="W"
					/>
					<span className="text-xs">×</span>
					<Input
						id="height"
						type="number"
						min="1"
						max={gridSizeY}
						value={height}
						onChange={(e) => setHeight(Number(e.target.value))}
						className="w-16 h-6 text-xs px-1"
						placeholder="H"
					/>
					<span className="text-xs">in</span>
				</div>

				<Button onClick={addItem} className="h-6 text-xs px-2">Add</Button>

				<div className="flex items-center gap-1 ml-auto border-l pl-3">
					<Input
						value={layoutName}
						onChange={(e) => setLayoutName(e.target.value)}
						className="w-24 h-6 text-xs px-1"
						placeholder="Layout name"
					/>
					<Button onClick={handleSave} className="h-6 text-xs px-2" variant="outline">Save</Button>
					{savedLayouts.length > 0 && (
						<div className="flex items-center gap-1">
							{savedLayouts.map((layout) => (
								<div key={layout.name} className="flex items-center">
									<Button
										onClick={() => handleLoad(layout)}
										className="h-6 text-xs px-2"
										variant="outline"
									>
										{layout.name}
									</Button>
									<button
										onClick={() => handleDelete(layout.name)}
										className="text-xs text-destructive hover:text-destructive/80 px-1"
										aria-label={`Delete ${layout.name}`}
									>
										x
									</button>
								</div>
							))}
						</div>
					)}
				</div>
				<span className="text-xs text-muted-foreground">1 cell = 1 inch</span>
			</div>

			{/* Grid */}
			<div className="w-full">
				<div className="border border-border bg-card w-full h-auto max-h-[70vh] rounded-md overflow-hidden" style={{ aspectRatio: gridSizeX / gridSizeY }}>
					<canvas
						ref={canvasRef}
						width={800}
						height={Math.round(800 * gridSizeY / gridSizeX)}
						style={{ width: '100%', height: '100%' }}
						onMouseDown={handleMouseDown}
						onMouseMove={handleMouseMove}
						onMouseUp={handleMouseUp}
						onMouseLeave={handleMouseUp}
					/>
				</div>
			</div>

			{/* Items List */}
			{items.length > 0 && (
				<div className="text-xs text-muted-foreground">
					Items: {items.map(item => `${item.label}(${item.width}×${item.height})`).join(', ')}
				</div>
			)}
		</div>
	);
}
