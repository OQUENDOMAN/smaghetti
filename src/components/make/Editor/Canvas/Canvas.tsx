import React, {
	CSSProperties,
	FunctionComponent,
	useRef,
	useState,
	memo,
} from 'react';
import clsx from 'clsx';
import { useHotkeys } from 'react-hotkeys-hook';

import { Entity } from '../../../Entity';
import { TransportSource } from '../../../Transport/TransportSource';
import { TransportDestination } from '../../../Transport/TransportDestination';
import { TILE_SIZE } from '../../../../tiles/constants';
import { MouseMode, RoomState } from '../../editorSlice';
import {
	PLAY_WINDOW_TILE_WIDTH,
	PLAY_WINDOW_TILE_HEIGHT,
} from '../../constants';
import { snap } from '../../../../util/snap';

import { entityMap, EntityType } from '../../../../entities/entityMap';

import styles from './Canvas.module.css';
import { bgGraphicToResourceMap } from '../../../../resources/bgGraphicToResourceMap';

type OnPaintedArg = {
	points: Point[];
	newGroup: boolean;
};

type CanvasProps = {
	className?: string;
	width: number;
	height: number;
	scale: number;
	currentPaletteEntry?: EntityType;
	rooms: RoomState[];
	currentRoomIndex: number;
	entities: EditorEntity[];
	transportSources: EditorTransport[];
	transportDestinations: EditorTransport[];
	matrix: EditorEntityMatrix;
	focused: Record<number, boolean>;
	isSelecting: boolean;
	dragOffset: Point | null;
	showGrid: boolean;
	mouseMode: MouseMode;
	onEntityDropped: (entity: EditorEntity | NewEditorEntity) => void;
	onPainted: (arg: OnPaintedArg) => void;
	onDeleteFocused: () => void;
	onEntitySettingsChange: (arg: {
		id: number;
		settings: EditorEntitySettings;
	}) => void;
	onTransportDestinationChange: (arg: {
		id: number;
		room: number;
		x: number;
		y: number;
	}) => void;
};

function getTranslation(scale: number): string {
	return `${((scale - 1) / 2) * 100}%`;
}

type MatrixRowProps = {
	cells: EditorEntityRow;
	y: number;
	focused: Record<number, boolean>;
	dragOffset: Point | null;
	onEntitySettingsChange: (arg: {
		id: number;
		settings: EditorEntitySettings;
	}) => void;
};

const MatrixRow: FunctionComponent<MatrixRowProps> = memo(function TileRow({
	cells,
	y,
	focused,
	dragOffset,
	onEntitySettingsChange,
}) {
	const tileEls = cells.map((c, x) => {
		const isFocused = !dragOffset && c !== null && focused[c.id];
		const focusCount = Object.keys(focused).length;

		const style = {
			position: 'absolute',
			left: x * TILE_SIZE,
			top: 0,
			opacity: dragOffset && c && focused[c.id] ? 0.3 : 1,
		} as const;

		return (
			c && (
				<div key={c.id} style={style}>
					<Entity
						id={c.id}
						type={c.type}
						focused={isFocused}
						soleFocused={isFocused && focusCount === 1}
						settings={c.settings}
						onEntitySettingsChange={(newSettings) =>
							onEntitySettingsChange({ id: c.id, settings: newSettings })
						}
					/>
				</div>
			)
		);
	});

	let draggingEls = null;

	if (dragOffset) {
		draggingEls = cells.map((c, x) => {
			if (!c) {
				return null;
			}

			if (focused[c.id]) {
				const style = {
					position: 'absolute',
					left: x * TILE_SIZE + dragOffset.x,
					top: dragOffset.y,
					opacity: dragOffset && c && focused[c.id] ? 0.3 : 1,
				} as const;

				return (
					<div key={c.id} style={style}>
						<Entity
							id={c.id}
							type={c.type}
							focused
							dragging
							settings={c.settings}
							onEntitySettingsChange={() => {}}
						/>
					</div>
				);
			} else {
				return null;
			}
		});
	}

	return (
		<div style={{ position: 'absolute', top: y * TILE_SIZE }}>
			{tileEls}
			{draggingEls}
		</div>
	);
});

type EntitiesProps = {
	entities: EditorEntity[];
	mouseMode: MouseMode;
	focused: Record<number, boolean>;
	isSelecting: boolean;
	dragOffset: Point | null;
	onEntitySettingsChange: (arg: {
		id: number;
		settings: EditorEntitySettings;
	}) => void;
};

const Entities = memo(function Entities({
	entities,
	mouseMode,
	focused,
	dragOffset,
	onEntitySettingsChange,
}: EntitiesProps) {
	const focusCount = Object.keys(focused).length;
	return (
		<>
			{entities.map((e) => {
				const isFocused =
					focused[e.id] && (mouseMode === 'select' || mouseMode === 'pan');

				return (
					<Entity
						key={`${e.type}-${e.id}`}
						style={{
							position: 'absolute',
							top: e.y,
							left: e.x,
							opacity: !!dragOffset && isFocused ? 0.3 : 1,
						}}
						id={e.id}
						type={e.type}
						settings={e.settings}
						focused={isFocused}
						soleFocused={isFocused && focusCount === 1}
						dragging={!!dragOffset}
						onEntitySettingsChange={(newSettings) =>
							onEntitySettingsChange({ id: e.id, settings: newSettings })
						}
					/>
				);
			})}
			{!!dragOffset &&
				entities.map((e) => {
					if (!focused[e.id]) {
						return null;
					}

					return (
						<Entity
							key={`dragging-${e.type}-${e.id}`}
							style={{
								position: 'absolute',
								top: e.y + dragOffset.y,
								left: e.x + dragOffset.x,
							}}
							focused
							dragging
							id={e.id}
							type={e.type}
							settings={e.settings}
							onEntitySettingsChange={() => {}}
						/>
					);
				})}
		</>
	);
});

type TransportsProps = {
	transports: EditorTransport[];
	rooms: RoomState[];
	mouseMode: MouseMode;
	focused: Record<number, boolean>;
	dragOffset: Point | null;
	onTransportDestinationChange: (arg: {
		id: number;
		room: number;
		x: number;
		y: number;
	}) => void;
};

const Transports = memo(function Transports({
	transports,
	rooms,
	mouseMode,
	focused,
	dragOffset,
	onTransportDestinationChange,
}: TransportsProps) {
	return (
		<>
			{transports.map((t) => {
				const isFocused =
					focused[t.id] && (mouseMode === 'select' || mouseMode === 'pan');

				return (
					<TransportSource
						key={`transport-${t.id}`}
						style={{
							position: 'absolute',
							top: t.y * TILE_SIZE,
							left: t.x * TILE_SIZE,
							opacity: !!dragOffset && isFocused ? 0.3 : 1,
						}}
						rooms={rooms}
						destRoom={t.destRoom}
						destX={t.destX}
						destY={t.destY}
						exitType={t.exitType}
						mouseMode={mouseMode}
						focused={!dragOffset && isFocused}
						onDestinationChange={({ room, x, y }) =>
							onTransportDestinationChange({ id: t.id, room, x, y })
						}
					/>
				);
			})}
			{!!dragOffset &&
				transports.map((t) => {
					if (!focused[t.id]) {
						return null;
					}

					return (
						<TransportSource
							key={`dragging-transport-${t.id}`}
							style={{
								position: 'absolute',
								top: t.y * TILE_SIZE + dragOffset.y,
								left: t.x * TILE_SIZE + dragOffset.x,
							}}
							destRoom={t.destRoom}
							destX={t.destX}
							destY={t.destY}
							exitType={t.exitType}
							focused
						/>
					);
				})}
		</>
	);
});

function getPointsBetween(oldP: Point, newP: Point, scale: number): Point[] {
	let distance = Math.sqrt((newP.x - oldP.x) ** 2 + (newP.y - oldP.y) ** 2);

	const step = Math.min(TILE_SIZE * scale, TILE_SIZE);

	if (distance <= step) {
		return [oldP, newP];
	}

	const points: Point[] = [];
	const angleFromAToB_rads = Math.atan2(newP.y - oldP.y, newP.x - oldP.x);

	let curPoint = oldP;

	while (distance > step) {
		const nextPoint = {
			x: curPoint.x + Math.cos(angleFromAToB_rads) * step,
			y: curPoint.y + Math.sin(angleFromAToB_rads) * step,
		};

		points.push(nextPoint);

		distance = Math.sqrt(
			(newP.x - nextPoint.x) ** 2 + (newP.y - nextPoint.y) ** 2
		);

		curPoint = nextPoint;
	}

	points.push(newP);

	return points;
}

const Canvas = memo(function Canvas({
	className,
	width,
	height,
	scale,
	currentPaletteEntry,
	rooms,
	currentRoomIndex,
	entities,
	transportSources,
	transportDestinations,
	matrix,
	focused,
	isSelecting,
	dragOffset,
	showGrid,
	mouseMode,
	onPainted,
	onDeleteFocused,
	onEntitySettingsChange,
	onTransportDestinationChange,
}: CanvasProps) {
	const [divRef, setDivRef] = useState<HTMLDivElement | null>(null);
	const [mouseDown, setMouseDown] = useState(false);
	const entityGhostRef = useRef<HTMLDivElement | null>(null);
	const lastMousePoint = useRef<Point | null>(null);

	useHotkeys('del', () => onDeleteFocused());

	const style = {
		'--scale': scale,
		'--translation': getTranslation(scale),
		width,
		height,
	} as CSSProperties;

	const gridDisplay = showGrid ? 'block' : 'none';
	const tileGridStyles = {
		'--grid-width': `${TILE_SIZE}px`,
		'--grid-height': `${TILE_SIZE}px`,
		'--grid-line-width': '0.3px',
		'--grid-color': 'rgba(0, 0, 0, 0.3)',
		display: gridDisplay,
	} as CSSProperties;

	const viewportGridStyles = {
		'--grid-width': `${TILE_SIZE * PLAY_WINDOW_TILE_WIDTH}px`,
		'--grid-height': `${TILE_SIZE * PLAY_WINDOW_TILE_HEIGHT}px`,
		'--grid-line-width': '0.8px',
		'--grid-color': 'rgba(255, 255, 255, 0.6)',
		backgroundPosition: 'left bottom',
		display: gridDisplay,
	} as CSSProperties;

	function getMousePoint(e: React.MouseEvent<HTMLDivElement>): Point {
		let rect;
		if (divRef) {
			rect = divRef.getBoundingClientRect();
		} else {
			rect = { x: 0, y: 0 };
		}

		const x = (e.clientX - rect.x) / scale;
		const y = (e.clientY - rect.y) / scale;

		return { x, y };
	}
	function sendPaint(curMousePoint: Point, newGroup: boolean) {
		const lastPoint = newGroup
			? curMousePoint
			: lastMousePoint.current ?? curMousePoint;

		const allPoints = getPointsBetween(lastPoint, curMousePoint, scale);

		onPainted({ points: allPoints, newGroup });

		lastMousePoint.current = curMousePoint;
	}

	const matrixRows = matrix.map(
		(row, y) =>
			row && (
				<MatrixRow
					key={y}
					cells={row}
					y={y}
					focused={focused}
					dragOffset={dragOffset}
					onEntitySettingsChange={onEntitySettingsChange}
				/>
			)
	);

	const borderStyle = {
		width: width * scale + 4,
		height: height * scale + 4,
	};

	const entityGhostDisplay =
		mouseMode === 'draw' && currentPaletteEntry ? 'block' : 'none';

	return (
		// TODO: why is border on its own div? probably due to scaling?
		<div className="border-2 border-black" style={borderStyle}>
			<div
				className={clsx(
					className,
					styles.root,
					bgGraphicToResourceMap[rooms[currentRoomIndex].settings.bgGraphic],
					'relative shadow-lg bg-blue-200',
					{
						'cursor-crosshair': mouseMode === 'draw' || mouseMode === 'fill',
					}
				)}
				ref={(div) => {
					setDivRef(div);
				}}
				style={style}
				onMouseDown={(e) => {
					if (mouseMode === 'pan') {
						return;
					}

					// ignore right clicks, and also ignore clicks on tiles/entities
					if (
						e.button !== 0 ||
						(e.target !== divRef &&
							(e.target as HTMLElement).getAttribute('data-editor-type') ===
								'entity' &&
							mouseMode === 'draw')
					) {
						setMouseDown(false);
						return;
					}

					if (mouseMode !== 'select') {
						setMouseDown(true);
						const mousePoint = getMousePoint(e);
						lastMousePoint.current = mousePoint;
						sendPaint(mousePoint, true);
					}
				}}
				onMouseUp={() => {
					setMouseDown(false);
					lastMousePoint.current = null;
				}}
				onMouseMove={(e) => {
					if (mouseDown) {
						sendPaint(getMousePoint(e), false);
					} else {
						const ghostPoint = getMousePoint(e);
						if (entityGhostRef.current && currentPaletteEntry) {
							entityGhostRef.current.style.left =
								snap(ghostPoint.x, TILE_SIZE) + 'px';
							entityGhostRef.current.style.top =
								snap(ghostPoint.y, TILE_SIZE) + 'px';
						}
					}
				}}
				onMouseLeave={() => {
					setMouseDown(false);
				}}
			>
				{currentPaletteEntry && (
					<div
						ref={entityGhostRef}
						style={{
							display: entityGhostDisplay,
							position: 'fixed',
							zIndex: 200,
							opacity: 0.3,
						}}
					>
						{entityMap[currentPaletteEntry].render(false, {}, () => {})}
					</div>
				)}
				<div className={styles.grid} style={tileGridStyles} />
				<div className={styles.grid} style={viewportGridStyles} />
				{matrixRows}
				<Entities
					entities={entities}
					focused={focused}
					isSelecting={isSelecting}
					mouseMode={mouseMode}
					dragOffset={dragOffset}
					onEntitySettingsChange={onEntitySettingsChange}
				/>
				<Transports
					rooms={rooms}
					transports={transportSources}
					focused={focused}
					mouseMode={mouseMode}
					dragOffset={dragOffset}
					onTransportDestinationChange={onTransportDestinationChange}
				/>
				{transportDestinations.map((td) => (
					<TransportDestination
						key={td.id}
						style={{
							position: 'absolute',
							top: td.destY * TILE_SIZE,
							left: td.destX * TILE_SIZE,
						}}
						mouseMode={mouseMode}
						rooms={rooms}
						destX={td.destX}
						destY={td.destY}
						destRoom={td.destRoom}
						exitType={td.exitType}
					/>
				))}
			</div>
		</div>
	);
});

export { Canvas };
export type { CanvasProps };
