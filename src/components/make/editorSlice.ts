import { createSlice, Action, PayloadAction } from '@reduxjs/toolkit';
import { ThunkAction } from 'redux-thunk';
import undoable, {
	ActionTypes as ReduxUndoActionTypes,
	ActionCreators,
	excludeAction,
	StateWithHistory,
} from 'redux-undo';
import produce from 'immer';
import { AppState } from '../../store';
import {
	MIN_LEVEL_TILE_WIDTH,
	MAX_LEVEL_TILE_WIDTH,
	MIN_LEVEL_TILE_HEIGHT,
	MAX_LEVEL_TILE_HEIGHT,
	INITIAL_LEVEL_TILE_HEIGHT,
	INITIAL_LEVEL_TILE_WIDTH,
	INITIAL_PLAYER_Y_TILE,
	INITIAL_PLAYER_X_TILE,
	PLAY_WINDOW_TILE_WIDTH,
	PLAY_WINDOW_TILE_HEIGHT,
} from './constants';
import { getPlayerScaleFromWindow } from '../../util/getPlayerScaleFromWindow';
import { saveLevel as saveLevelMutation } from '../../remoteData/saveLevel';
import { getLevel as getLevelQuery } from '../../remoteData/getLevel';
import { serialize } from '../../level/serialize';
import { deserialize } from '../../level/deserialize';
import isEqual from 'lodash/isEqual';
import cloneDeep from 'lodash/cloneDeep';

import { TILE_SIZE, TILE_TYPE_TO_GROUP_TYPE_MAP } from '../../tiles/constants';
import { entityMap, EntityType } from '../../entities/entityMap';
import { ROOM_TYPE_SETTINGS } from '../../levelData/constants';
import { isCompatibleEntity } from './util';

type LocalStorageData = {
	metadata: {
		name: string;
	};
	levelData: SerializedLevelData;
};

type MouseMode = 'select' | 'draw' | 'fill' | 'erase' | 'pan';

type EditorFocusRect = {
	offset: Point;
	width: number;
	height: number;
};

const nonDeletableEntityTypes = ['Player'];

const playerScale = getPlayerScaleFromWindow();
const scales: number[] = [
	playerScale / 6,
	playerScale / 4,
	playerScale / 3,
	playerScale / 2,
	playerScale,
	playerScale * 2,
];

type RoomState = {
	settings: RoomSettings;
	entities: EditorEntity[];
	transports: EditorTransport[];
	tiles: TileMatrix;
	roomTileWidth: number;
	roomTileHeight: number;

	scale: number;
	canIncreaseScale: boolean;
	canDecreaseScale: boolean;
	editorVisibleWindow: EditorFocusRect;
	scrollOffset: Point;
	paletteEntries: EntityType[];
	currentPaletteEntry?: EntityType;
};

type InternalEditorState = {
	metadata: {
		name: string;
	};
	rooms: RoomState[];
	currentRoomIndex: number;

	paintedGroup: string;
	/**
	 * When the user presses spacebar to pan, this is where the current
	 * mouse mode is stashed so it can be restored when they let go
	 */
	storedMouseMode?: MouseMode | null;

	/**
	 * These store state when going into an alternate mode such as resizing or managing
	 * rooms. The presence of this state indicates the editor is in that mode.
	 *
	 * TODO: this is cumbersome and does not scale. There has to be a (much) better way,
	 * and debatable if the slice should even know or care about these modes
	 */
	storedForResizeMode?: { scale: number; offset: Point } | null;
	storedForManageRoomsMode?: { scale: number; offset: Point } | null;

	mouseMode: MouseMode;
	pendingLevelResizeIncrement: Point;
	showGrid: boolean;
	focused: Record<number, boolean>;
	dragOffset: Point | null;
	isSelecting: boolean;
	savedLevelId?: string;
	saveLevelState: 'dormant' | 'saving' | 'error' | 'success';
	loadLevelState: 'dormant' | 'loading' | 'error' | 'missing' | 'success';
};

const initialScale = playerScale;

function getCurrentRoom(state: InternalEditorState): RoomState {
	return state.rooms[state.currentRoomIndex];
}

/**
 * Figure out what the y scroll should be such that the player and start
 * are placed in the lower left corner of the browser window.
 *
 * NOTE: this only works correctly when the level is still INITIAL_LEVEL_TILE_HEIGHT
 * tall.
 */
function calcYForScrollToBottom() {
	if (typeof window === 'undefined') {
		return 0;
	}

	const levelHeight = INITIAL_LEVEL_TILE_HEIGHT * TILE_SIZE * initialScale;
	const windowHeight = window.innerHeight;

	return (levelHeight - windowHeight) / initialScale;
}

const initialRoomState: RoomState = {
	settings: {
		...ROOM_TYPE_SETTINGS.underground,
	},
	entities: [
		{
			id: 1,
			x: TILE_SIZE * INITIAL_PLAYER_X_TILE,
			y: TILE_SIZE * INITIAL_PLAYER_Y_TILE,
			type: 'Player',
		},
	],
	transports: [],
	tiles: [],
	roomTileWidth: INITIAL_LEVEL_TILE_WIDTH,
	roomTileHeight: INITIAL_LEVEL_TILE_HEIGHT,
	scale: initialScale,
	canIncreaseScale: scales.indexOf(initialScale) < scales.length - 1,
	canDecreaseScale: scales.indexOf(initialScale) > 0,
	editorVisibleWindow: {
		offset: { x: 0, y: 0 },
		width: 0,
		height: 0,
	},
	scrollOffset: { x: 0, y: calcYForScrollToBottom() },
	paletteEntries: ['Brick', 'Coin', 'Goomba'],
	currentPaletteEntry: 'Goomba',
};

const defaultInitialState: InternalEditorState = {
	metadata: {
		name: 'new level',
	},
	paintedGroup: '',
	saveLevelState: 'dormant',
	loadLevelState: 'dormant',
	mouseMode: 'draw',
	pendingLevelResizeIncrement: { x: 0, y: 0 },
	showGrid: true,
	focused: {},
	dragOffset: null,
	isSelecting: false,
	rooms: [initialRoomState],
	currentRoomIndex: 0,
};

const initialState = defaultInitialState;

const EMPTY_SERIALIZED_LEVEL: SerializedLevelData = {
	rooms: [
		{
			settings: { ...initialState.rooms[0].settings },
			paletteEntries: [...initialState.rooms[0].paletteEntries],
			entities: [...initialState.rooms[0].entities],
			transports: [],
			tileLayer: {
				data: [],
				width: PLAY_WINDOW_TILE_WIDTH,
				height: PLAY_WINDOW_TILE_HEIGHT,
			},
			tileSettings: [],
		},
	],
};

let idCounter = 10;

function getPaintedGroup(point: Point, mouseMode: MouseMode) {
	return `${mouseMode}-${point.x}-${point.y}`;
}

type FloodBounds = {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
};

function floodFill(
	tiles: TileMatrix,
	floodTileType: EntityType,
	indexX: number,
	indexY: number,
	levelTileWidth: number,
	levelTileHeight: number
): FloodBounds {
	const targetTile = tiles[indexY]?.[indexX];
	const targetType = targetTile?.tileType ?? 0;

	const toProcess: Point[] = [{ x: indexX, y: indexY }];

	const outsideOfLevel = (p: Point): boolean => {
		return (
			p.x < 0 || p.x >= levelTileWidth || p.y < 0 || p.y >= levelTileHeight
		);
	};

	const seenPoints: Point[] = [];
	const floodBounds: FloodBounds = {
		minX: levelTileWidth,
		minY: levelTileHeight,
		maxX: 0,
		maxY: 0,
	};

	while (toProcess.length > 0) {
		const point = toProcess.pop() as Point;

		if (
			outsideOfLevel(point) ||
			seenPoints.find((sp) => sp.x === point.x && sp.y === point.y)
		) {
			continue;
		}

		seenPoints.push(point);

		floodBounds.minX = Math.min(floodBounds.minX, point.x);
		floodBounds.minY = Math.min(floodBounds.minY, point.y);
		floodBounds.maxX = Math.max(floodBounds.maxX, point.x);
		floodBounds.maxY = Math.max(floodBounds.maxY, point.y);

		const tileAtPoint = tiles[point.y]?.[point.x];

		let exploreNeighbors = false;

		if (tileAtPoint) {
			if (tileAtPoint.tileType === targetType) {
				tileAtPoint.tileType = floodTileType;
				exploreNeighbors = true;
			}
		} else if (targetType === 0) {
			tiles[point.y] = tiles[point.y] || [];
			tiles[point.y]![point.x] = {
				id: idCounter++,
				x: point.x,
				y: point.y,
				tileType: floodTileType,
				tileIndex: 0,
			};
			exploreNeighbors = true;
		}

		if (exploreNeighbors) {
			// to the left
			toProcess.push({
				x: point.x - 1,
				y: point.y,
			});
			// to the right
			toProcess.push({
				x: point.x + 1,
				y: point.y,
			});
			// to the top
			toProcess.push({
				x: point.x,
				y: point.y - 1,
			});
			// to the bottom
			toProcess.push({
				x: point.x,
				y: point.y + 1,
			});
		}
	}

	return floodBounds;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}

function getEntityPixelBounds(entity: NewEditorEntity): Bounds {
	const spriteDef = entityMap[entity.type];
	const width = Math.max(spriteDef.tiles[0].length * 8, TILE_SIZE);
	const height = Math.max(spriteDef.tiles.length * 8, TILE_SIZE);

	return {
		upperLeft: { x: entity.x, y: entity.y },
		lowerRight: { x: entity.x + width, y: entity.y + height },
	};
}

function getEntityTileBounds(entity: NewEditorEntity): Bounds {
	const spriteDef = entityMap[entity.type];

	const tileWidth = spriteDef.tiles[0].length / 2;
	const tileHeight = spriteDef.tiles.length / 2;

	const minX = Math.floor(entity.x / TILE_SIZE);
	const minY = Math.floor(entity.y / TILE_SIZE);

	const maxX = minX + tileWidth - 1;
	const maxY = minY + tileHeight - 1;

	return {
		upperLeft: { x: minX, y: minY },
		lowerRight: { x: maxX, y: maxY },
	};
}

function pointIsInside(a: Point, b: Bounds) {
	if (a.x < b.upperLeft.x) {
		return false;
	}

	// a is completely to the right of b
	if (a.x > b.lowerRight.x) {
		return false;
	}

	// a is completely above b
	if (a.y < b.upperLeft.y) {
		return false;
	}

	// a is completely below b
	if (a.y > b.lowerRight.y) {
		return false;
	}

	return true;
}

function overlap(a: Bounds, b: Bounds): boolean {
	// a is completely to the left of b
	if (a.lowerRight.x < b.upperLeft.x) {
		return false;
	}

	// a is completely to the right of b
	if (a.upperLeft.x > b.lowerRight.x) {
		return false;
	}

	// a is completely above b
	if (a.lowerRight.y < b.upperLeft.y) {
		return false;
	}

	// a is completely below b
	if (a.upperLeft.y > b.lowerRight.y) {
		return false;
	}

	return true;
}

function isNotANewEntity(e: NewEditorEntity | EditorEntity): e is EditorEntity {
	return 'id' in e && !!e.id;
}

function canDrop(
	entity: NewEditorEntity | EditorEntity,
	entities: EditorEntity[]
) {
	const entityBounds = getEntityTileBounds(entity);

	return !entities.some((otherEntity) => {
		// ignore the current entity, allow it to drop back down onto itself
		if (isNotANewEntity(entity) && otherEntity.id === entity.id) {
			return false;
		}

		const otherBounds = getEntityTileBounds(otherEntity);

		return overlap(entityBounds, otherBounds);
	});
}

function getEntityX(inputX: number): number {
	return Math.floor(inputX / TILE_SIZE) * TILE_SIZE;
}

function getEntityY(inputY: number): number {
	return Math.floor(inputY / TILE_SIZE) * TILE_SIZE;
}

function ensurePlayerIsInView(state: InternalEditorState, offsetDelta: Point) {
	const player = getCurrentRoom(state).entities.find(
		(e) => e.type === 'Player'
	)!;

	player.x = clamp(
		player.x + offsetDelta.x,
		0,
		(getCurrentRoom(state).roomTileWidth - 1) * TILE_SIZE
	);
	player.y = clamp(
		player.y + offsetDelta.y,
		0,
		(getCurrentRoom(state).roomTileHeight - 1) * TILE_SIZE
	);
}

/**
 * Ensures that scrollOffset doesn't get too far out, which would cause the level
 * to completely not show up in the browser window
 */
function ensureLevelIsInView(state: InternalEditorState) {
	if (typeof window === 'undefined') {
		return;
	}

	const windowWidth = window.innerWidth / getCurrentRoom(state).scale;
	const windowHeight = window.innerHeight / getCurrentRoom(state).scale;

	const levelWidthPx = getCurrentRoom(state).roomTileWidth * TILE_SIZE;
	const levelHeightPx = getCurrentRoom(state).roomTileHeight * TILE_SIZE;

	getCurrentRoom(state).scrollOffset.x = clamp(
		getCurrentRoom(state).scrollOffset.x,
		-windowWidth + TILE_SIZE,
		levelWidthPx - TILE_SIZE
	);

	getCurrentRoom(state).scrollOffset.y = clamp(
		getCurrentRoom(state).scrollOffset.y,
		-windowHeight + TILE_SIZE,
		levelHeightPx - TILE_SIZE
	);
}

function removeOutOfBoundsEntities(state: InternalEditorState) {
	const levelBounds = {
		upperLeft: { x: 0, y: 0 },
		lowerRight: {
			x: getCurrentRoom(state).roomTileWidth * TILE_SIZE,
			y: getCurrentRoom(state).roomTileHeight * TILE_SIZE,
		},
	};

	getCurrentRoom(state).entities = getCurrentRoom(state).entities.filter(
		(e) => {
			if (nonDeletableEntityTypes.includes(e.type)) {
				return true;
			}

			const pixelBounds = getEntityPixelBounds(e);

			return overlap(pixelBounds, levelBounds);
		}
	);
}

function removeOutOfBoundsTiles(state: InternalEditorState) {
	getCurrentRoom(state).tiles = getCurrentRoom(state).tiles.map((row) => {
		return row?.slice(0, getCurrentRoom(state).roomTileWidth) ?? null;
	});

	getCurrentRoom(state).tiles = getCurrentRoom(state).tiles.slice(
		0,
		getCurrentRoom(state).roomTileHeight
	);
}

function scaleTo(state: InternalEditorState, newScale: number) {
	const newScaleIndex = scales.indexOf(newScale);

	getCurrentRoom(state).scale = newScale;
	getCurrentRoom(state).canIncreaseScale =
		newScaleIndex !== -1 && newScaleIndex < scales.length - 1;
	getCurrentRoom(state).canDecreaseScale =
		newScaleIndex !== -1 && newScaleIndex > 0;
}

/**
 * when in resize mode, the minimum amount to have around the edges of
 * the canvas when sized to fit the window
 */
const EDGE_BUFFER_SIZE = 200;

function determineResizeScale(state: InternalEditorState): number {
	// this is actual pixels, ie when the level is scaled to 1
	const levelWidthInPixels = getCurrentRoom(state).roomTileWidth * TILE_SIZE;
	const levelHeightInPixels = getCurrentRoom(state).roomTileHeight * TILE_SIZE;

	const maxWidthInPixels = window.innerWidth - EDGE_BUFFER_SIZE * 2;
	const maxHeightInPixels = window.innerHeight - EDGE_BUFFER_SIZE * 2;

	const horizontalScale = maxWidthInPixels / levelWidthInPixels;
	const verticalScale = maxHeightInPixels / levelHeightInPixels;

	return Math.min(horizontalScale, verticalScale);
}

function setScaleAndOffsetForManageRooms(state: InternalEditorState) {
	const currentRoom = getCurrentRoom(state);

	const widthInTiles = Math.max(...state.rooms.map((r) => r.roomTileWidth)) + 5;
	let heightInTiles = state.rooms.reduce<number>((building, room) => {
		return building + room.roomTileHeight;
	}, 0);

	// add 4 tiles between each room to account for the padding
	heightInTiles += 4 * (state.rooms.length - 1);

	const widthInPx = widthInTiles * TILE_SIZE;
	const heightInPx = heightInTiles * TILE_SIZE;

	const widthScale = (window.innerWidth * 0.75) / widthInPx;
	const heightScale = (window.innerHeight * 0.75) / heightInPx;

	const scale = Math.min(widthScale, heightScale);
	currentRoom.scale = scale;

	const scaledWidthPx = widthInPx * scale;
	const scaledHeightPx = heightInPx * scale;

	currentRoom.scrollOffset = {
		x: -(window.innerWidth / 2 - scaledWidthPx / 2) / scale,
		y: -(window.innerHeight / 2 - scaledHeightPx / 2) / scale,
	};
}

function centerLevelInWindow(state: InternalEditorState) {
	const currentRoom = getCurrentRoom(state);
	// this is onscreen pixels, as in how many pixels the level is taking up at the current scale on the window
	const levelWidthInPixels =
		currentRoom.roomTileWidth * TILE_SIZE * currentRoom.scale;
	const levelHeightInPixels =
		currentRoom.roomTileHeight * TILE_SIZE * currentRoom.scale;

	const upperPixels = (window.innerHeight - levelHeightInPixels) / 2;
	const leftPixels = (window.innerWidth - levelWidthInPixels) / 2;

	currentRoom.scrollOffset.x = -leftPixels / currentRoom.scale;
	currentRoom.scrollOffset.y = -upperPixels / currentRoom.scale;
}

function selectEntireTileEntity(
	focused: Record<number, boolean>,
	tiles: TileMatrix,
	focusedTile: Tile
) {
	const groupType = TILE_TYPE_TO_GROUP_TYPE_MAP[focusedTile.tileType];
	const { x, y } = focusedTile;

	if (groupType === 'x') {
		let startX = focusedTile.x;

		while (tiles[y]?.[startX - 1]?.tileType === focusedTile.tileType) {
			startX -= 1;
		}

		let endX = focusedTile.x;

		while (tiles[y]?.[endX + 1]?.tileType === focusedTile.tileType) {
			endX += 1;
		}

		for (let t = startX; t <= endX; ++t) {
			focused[tiles[y]![t]!.id] = true;
		}
	} else if (groupType === 'y') {
		let startY = focusedTile.y;

		while (tiles[startY - 1]?.[x]?.tileType === focusedTile.tileType) {
			startY -= 1;
		}

		let endY = focusedTile.y;

		while (tiles[endY + 1]?.[x]?.tileType === focusedTile.tileType) {
			endY += 1;
		}

		for (let t = startY; t <= endY; ++t) {
			focused[tiles[t]![x]!.id] = true;
		}
	}
}

function findTile(tiles: TileMatrix, id: number): Tile | null {
	for (let y = 0; y < tiles.length; ++y) {
		for (let x = 0; !!tiles[y] && x < tiles[y]!.length; ++x) {
			if (tiles[y]![x]?.id === id) {
				return tiles[y]![x];
			}
		}
	}

	return null;
}

// Each ace coin is given a specific index, so the game can keep track of
// which coins have been collected. Whenever a new ace coin is added or deleted,
// the indices need to be updated
function assignAceCoinIndices(rooms: RoomState[]) {
	const allEntities = rooms.reduce<EditorEntity[]>((building, room) => {
		return building.concat(room.entities);
	}, []);

	let aceCoinIndex = 0;

	for (let i = 0; i < allEntities.length; ++i) {
		const e = allEntities[i];

		if (e.type === 'AceCoin') {
			e.settings = { aceCoinIndex };
			aceCoinIndex += 1;

			if (aceCoinIndex === 5) {
				break;
			}
		}
	}
}

const editorSlice = createSlice({
	name: 'editor',
	initialState,
	reducers: {
		setLevelName(state: InternalEditorState, action: PayloadAction<string>) {
			state.metadata.name = action.payload.trim() || 'new level';
		},
		setCurrentRoomIndex(
			state: InternalEditorState,
			action: PayloadAction<number>
		) {
			const newRoomIndex = action.payload;
			if (newRoomIndex >= 0 && newRoomIndex < state.rooms.length) {
				state.currentRoomIndex = newRoomIndex;
			}
		},
		addPaletteEntry(
			state: InternalEditorState,
			action: PayloadAction<EntityType>
		) {
			const currentRoom = getCurrentRoom(state);

			const newEntry = action.payload;

			if (!currentRoom.paletteEntries.some((p) => p === newEntry)) {
				currentRoom.paletteEntries.push(newEntry);
				currentRoom.currentPaletteEntry =
					currentRoom.paletteEntries[currentRoom.paletteEntries.length - 1];
			} else {
				// already in the palette? just select it then
				const index = currentRoom.paletteEntries.findIndex((p) =>
					isEqual(p, newEntry)
				);

				if (index > -1) {
					currentRoom.currentPaletteEntry = currentRoom.paletteEntries[index];
				}
			}
		},
		removePaletteEntry(
			state: InternalEditorState,
			action: PayloadAction<EntityType>
		) {
			const entryToRemove = action.payload;
			const index = getCurrentRoom(state).paletteEntries.findIndex((pe) =>
				// TODO: isEqual no longer needed
				isEqual(pe, entryToRemove)
			);

			if (isEqual(entryToRemove, getCurrentRoom(state).currentPaletteEntry)) {
				let nextIndex = index - 1;

				if (nextIndex < 0) {
					nextIndex = index + 1;
				}

				getCurrentRoom(state).currentPaletteEntry = getCurrentRoom(
					state
				).paletteEntries[nextIndex];
			}

			getCurrentRoom(state).paletteEntries.splice(index, 1);
		},
		setCurrentPaletteEntryByIndex(
			state: InternalEditorState,
			action: PayloadAction<number>
		) {
			const index = action.payload;

			if (index >= 0 && index < getCurrentRoom(state).paletteEntries.length) {
				getCurrentRoom(state).currentPaletteEntry = getCurrentRoom(
					state
				).paletteEntries[index];
			}
		},
		entityDropped(
			state: InternalEditorState,
			action: PayloadAction<EditorEntity | NewEditorEntity>
		) {
			if (!canDrop(action.payload, getCurrentRoom(state).entities)) {
				return;
			}

			if ('id' in action.payload) {
				const { id } = action.payload;
				const entity = getCurrentRoom(state).entities.find((e) => e.id === id);

				if (entity) {
					Object.assign(entity, action.payload, {
						x: getEntityX(action.payload.x),
						y: getEntityY(action.payload.y),
					});
				}
			} else {
				getCurrentRoom(state).entities.push({
					...action.payload,
					x: getEntityX(action.payload.x),
					y: getEntityY(action.payload.y),
					id: idCounter++,
				});
			}
		},
		// TODO: refactor this, so messy
		painted(
			state: InternalEditorState,
			action: PayloadAction<{ points: Point[]; newGroup: boolean }>
		) {
			const currentRoom = getCurrentRoom(state);
			const { points, newGroup } = action.payload;

			if (newGroup) {
				state.paintedGroup = getPaintedGroup(points[0], state.mouseMode);
			}

			let minX = currentRoom.roomTileWidth;
			let minY = currentRoom.roomTileHeight;
			let maxX = 0;
			let maxY = 0;

			points.forEach((point) => {
				const indexX = Math.floor(point.x / TILE_SIZE);
				const indexY = Math.floor(point.y / TILE_SIZE);

				minX = Math.min(minX, indexX);
				minY = Math.min(minY, indexY);
				maxX = Math.max(maxX, indexX);
				maxY = Math.max(maxY, indexY);

				const existingTile = currentRoom.tiles[indexY]?.[indexX];

				const tilePoint = {
					x: indexX,
					y: indexY,
				};

				switch (state.mouseMode) {
					case 'erase': {
						const existingEntity = currentRoom.entities.find((e) => {
							return pointIsInside(tilePoint, getEntityTileBounds(e));
						});

						if (
							existingEntity &&
							!nonDeletableEntityTypes.includes(existingEntity.type)
						) {
							currentRoom.entities = currentRoom.entities.filter(
								(e) => e !== existingEntity
							);

							if (existingEntity.type === 'AceCoin') {
								assignAceCoinIndices(state.rooms);
							}
						}

						if (currentRoom.tiles[indexY]) {
							currentRoom.tiles[indexY]![indexX] = null;
						}

						const existingTransport = currentRoom.transports.find((t) => {
							return pointIsInside(tilePoint, {
								// TODO: are bounds inclusive?
								upperLeft: { x: t.x, y: t.y },
								lowerRight: { x: t.x + 1, y: t.y + 1 },
							});
						});

						if (existingTransport) {
							currentRoom.transports = currentRoom.transports.filter(
								(t) => t !== existingTransport
							);
						}

						break;
					}
					case 'draw': {
						if (
							currentRoom.currentPaletteEntry &&
							entityMap[currentRoom.currentPaletteEntry].editorType === 'tile'
						) {
							// replace a tile
							if (existingTile) {
								existingTile.tileType = currentRoom.currentPaletteEntry;
							} else {
								// paint a new tile
								currentRoom.tiles[indexY] = currentRoom.tiles[indexY] || [];
								currentRoom.tiles[indexY]![indexX] = {
									id: idCounter++,
									x: indexX,
									y: indexY,
									tileType: currentRoom.currentPaletteEntry,
									// TODO: tileIndex isn't really used anymore
									tileIndex: 0,
								};

								const objectDef = entityMap[currentRoom.currentPaletteEntry];

								if (objectDef.settingsType === 'single') {
									currentRoom.tiles[indexY]![indexX]!.settings = {
										...objectDef.defaultSettings,
									};
								}
							}
						} else if (
							currentRoom.currentPaletteEntry &&
							entityMap[currentRoom.currentPaletteEntry].editorType === 'entity'
						) {
							// place an entity
							const type = currentRoom.currentPaletteEntry;

							const newEntity: NewEditorEntity = {
								x: getEntityX(point.x),
								y: getEntityY(point.y),
								type,
							};

							if (
								canDrop(newEntity, currentRoom.entities) &&
								(type !== 'AceCoin' ||
									currentRoom.entities.filter((e) => e.type === 'AceCoin')
										.length < 5)
							) {
								const completeEntity: EditorEntity = {
									...newEntity,
									id: idCounter++,
								};

								currentRoom.entities.push(completeEntity);

								// TODO: is this still necessary
								// if (completeEntity.type in detailsPanes) {
								// 	state.focused = { [completeEntity.id]: true };
								// }
								if (type === 'AceCoin') {
									assignAceCoinIndices(state.rooms);
								}
							}
						} else if (
							currentRoom.currentPaletteEntry &&
							entityMap[currentRoom.currentPaletteEntry].editorType ===
								'transport'
						) {
							const newTransport: EditorTransport = {
								id: idCounter++,
								x: getEntityX(point.x) / TILE_SIZE,
								y: getEntityY(point.y) / TILE_SIZE,
								room: state.currentRoomIndex,
								destX: -1,
								destY: -1,
								destRoom: -1,
								exitType: 0,
							};

							// only allow the new transport if one doesn't already exist at that location
							if (
								!currentRoom.transports.some(
									(t) => t.x === newTransport.x && t.y === newTransport.y
								)
							) {
								currentRoom.transports.push(newTransport);
							}
						}
						break;
					}
					// TODO: fill entities
					case 'fill': {
						if (
							currentRoom.currentPaletteEntry &&
							entityMap[currentRoom.currentPaletteEntry].editorType === 'tile'
						) {
							const floodResult = floodFill(
								currentRoom.tiles,
								currentRoom.currentPaletteEntry,
								indexX,
								indexY,
								currentRoom.roomTileWidth,
								currentRoom.roomTileHeight
							);

							minX = floodResult.minX;
							minY = floodResult.minY;
							maxX = floodResult.maxX;
							maxY = floodResult.maxY;
						}

						break;
					}
				}
			});

			minX = Math.max(0, minX - 1);
			minY = Math.max(0, minY - 1);
			maxX = Math.min(currentRoom.roomTileWidth, maxX + 1);
			maxY = Math.min(currentRoom.roomTileHeight, maxY + 1);
		},
		deleteFocused(state: InternalEditorState) {
			const currentRoom = getCurrentRoom(state);

			currentRoom.entities = currentRoom.entities.filter((e) => {
				return nonDeletableEntityTypes.includes(e.type) || !state.focused[e.id];
			});

			currentRoom.transports = currentRoom.transports.filter((t) => {
				return !state.focused[t.id];
			});

			let minX = currentRoom.roomTileWidth;
			let minY = currentRoom.roomTileHeight;
			let maxX = 0;
			let maxY = 0;

			currentRoom.tiles = currentRoom.tiles.map((row, y) => {
				if (!row) {
					return null;
				}

				return row.map((t, x) => {
					if (!t) {
						return t;
					}

					if (state.focused[t.id]) {
						minX = Math.min(minX, x);
						maxX = Math.max(maxX, x);
						minY = Math.min(minY, y);
						maxY = Math.max(maxY, y);

						return null;
					} else {
						return t;
					}
				});
			});

			state.focused = {};

			assignAceCoinIndices(state.rooms);
		},
		mouseModeChanged(
			state: InternalEditorState,
			action: PayloadAction<MouseMode>
		) {
			const currentRoom = getCurrentRoom(state);

			if (
				(currentRoom.currentPaletteEntry &&
					entityMap[currentRoom.currentPaletteEntry].editorType !== 'entity') ||
				action.payload !== 'fill'
			) {
				state.mouseMode = action.payload;
				state.focused = {};
			}
		},
		resizeLevel(state: InternalEditorState, action: PayloadAction<Point>) {
			const currentRoom = getCurrentRoom(state);

			state.pendingLevelResizeIncrement.x +=
				action.payload.x / (TILE_SIZE * currentRoom.scale);

			const tileDiffX = Math.floor(state.pendingLevelResizeIncrement.x);
			state.pendingLevelResizeIncrement.x -= tileDiffX;

			currentRoom.roomTileWidth = clamp(
				currentRoom.roomTileWidth + tileDiffX,
				MIN_LEVEL_TILE_WIDTH,
				MAX_LEVEL_TILE_WIDTH
			);

			// HEIGHT

			state.pendingLevelResizeIncrement.y +=
				action.payload.y / (TILE_SIZE * currentRoom.scale);

			const tileDiffY = Math.floor(state.pendingLevelResizeIncrement.y);
			state.pendingLevelResizeIncrement.y -= tileDiffY;

			currentRoom.roomTileHeight = clamp(
				currentRoom.roomTileHeight + tileDiffY,
				MIN_LEVEL_TILE_HEIGHT,
				MAX_LEVEL_TILE_HEIGHT
			);
		},
		resizeLevelComplete(state: InternalEditorState) {
			const newScale = determineResizeScale(state);
			scaleTo(state, newScale);
			centerLevelInWindow(state);
		},
		eraseLevel(state: InternalEditorState) {
			state.rooms = [cloneDeep(defaultInitialState.rooms[0])];
			state.currentRoomIndex = 0;

			if (state.storedForResizeMode) {
				const newScale = determineResizeScale(state);
				scaleTo(state, newScale);
				centerLevelInWindow(state);
			}

			state.metadata.name = defaultInitialState.metadata.name;
		},
		resetOffset(state: InternalEditorState) {
			getCurrentRoom(state).scrollOffset.x = 0;
			getCurrentRoom(state).scrollOffset.y = calcYForScrollToBottom();
		},
		editorVisibleWindowChanged(
			state: InternalEditorState,
			action: PayloadAction<EditorFocusRect>
		) {
			const currentRoom = getCurrentRoom(state);

			currentRoom.editorVisibleWindow = action.payload;
			currentRoom.scrollOffset = action.payload.offset;
		},
		scaleDecreased(state: InternalEditorState) {
			const currentScaleIndex = scales.indexOf(getCurrentRoom(state).scale);
			const newScaleIndex = Math.max(0, currentScaleIndex - 1);

			if (newScaleIndex !== currentScaleIndex) {
				scaleTo(state, scales[newScaleIndex]);
			}
		},
		scaleIncreased(state: InternalEditorState) {
			const currentScaleIndex = scales.indexOf(getCurrentRoom(state).scale);
			const newScaleIndex = Math.min(scales.length - 1, currentScaleIndex + 1);

			if (newScaleIndex !== currentScaleIndex) {
				scaleTo(state, scales[newScaleIndex]);
			}
		},
		toggleResizeMode(state: InternalEditorState) {
			const currentRoom = getCurrentRoom(state);

			if (state.storedForResizeMode) {
				scaleTo(state, state.storedForResizeMode.scale);
				currentRoom.scrollOffset = state.storedForResizeMode.offset;

				state.storedForResizeMode = null;
			} else {
				state.storedForResizeMode = {
					scale: currentRoom.scale,
					offset: { ...currentRoom.scrollOffset },
				};

				const newScale = determineResizeScale(state);
				scaleTo(state, newScale);
				centerLevelInWindow(state);
			}
		},
		toggleManageRoomsMode(state: InternalEditorState) {
			const currentRoom = getCurrentRoom(state);

			if (state.storedForManageRoomsMode) {
				scaleTo(state, state.storedForManageRoomsMode.scale);
				currentRoom.scrollOffset = state.storedForManageRoomsMode.offset;

				state.storedForManageRoomsMode = null;
			} else {
				state.storedForManageRoomsMode = {
					scale: currentRoom.scale,
					offset: { ...currentRoom.scrollOffset },
				};

				setScaleAndOffsetForManageRooms(state);
			}
		},
		addRoom(state: InternalEditorState) {
			if (state.rooms.length < 4) {
				state.rooms.push(cloneDeep(initialRoomState));
				setScaleAndOffsetForManageRooms(state);
			}
		},
		deleteRoom(state: InternalEditorState, action: PayloadAction<number>) {
			if (state.rooms.length > 1) {
				const deletedIndex = action.payload;
				state.rooms = state.rooms.filter((r, i) => i !== deletedIndex);
				state.currentRoomIndex = Math.min(
					state.currentRoomIndex,
					state.rooms.length - 1
				);
				setScaleAndOffsetForManageRooms(state);
			}
		},
		roomSettingsChange(
			state: InternalEditorState,
			action: PayloadAction<{ index: number; settings: RoomSettings }>
		) {
			const { index, settings } = action.payload;
			const room = state.rooms[index];
			room.settings = settings;

			room.entities = room.entities.filter((e) =>
				isCompatibleEntity(e.type, settings)
			);

			room.tiles = room.tiles.map((row) => {
				if (!row) {
					return row;
				}

				return row.map((tile) => {
					if (!tile) {
						return tile;
					}

					return isCompatibleEntity(tile.tileType, settings) ? tile : null;
				});
			});

			room.paletteEntries = room.paletteEntries.filter((pe) =>
				isCompatibleEntity(pe, settings)
			);
		},
		setSaveLevelState(
			state: InternalEditorState,
			action: PayloadAction<InternalEditorState['saveLevelState']>
		) {
			state.saveLevelState = action.payload;
		},
		setSavedLevelId(state: InternalEditorState, action: PayloadAction<string>) {
			state.savedLevelId = action.payload;
		},
		setLoadLevelState(
			state: InternalEditorState,
			action: PayloadAction<InternalEditorState['loadLevelState']>
		) {
			state.loadLevelState = action.payload;
		},
		setPaletteEntries(
			state: InternalEditorState,
			action: PayloadAction<EntityType[]>
		) {
			getCurrentRoom(state).paletteEntries = action.payload;
		},
		setLevelDataFromLoad(
			state: InternalEditorState,
			action: PayloadAction<SerializedLevelData>
		) {
			const { levelData, maxId } = deserialize(action.payload);

			state.rooms = levelData.rooms.map((r) => {
				return {
					settings: r.settings,
					entities: r.entities.filter((e) => !!entityMap[e.type]),
					transports: r.transports,
					tiles: r.tileLayer.data,
					roomTileHeight: r.tileLayer.height,
					roomTileWidth: r.tileLayer.width,
					scale: initialScale,
					canIncreaseScale: scales.indexOf(initialScale) < scales.length - 1,
					canDecreaseScale: scales.indexOf(initialScale) > 0,
					editorVisibleWindow: {
						offset: { x: 0, y: 0 },
						width: 0,
						height: 0,
					},
					scrollOffset: { x: 0, y: calcYForScrollToBottom() },
					paletteEntries: r.paletteEntries ?? [],
					currentPaletteEntry: r.paletteEntries?.[0],
				};
			});

			state.rooms.forEach((r) => {
				const player = r.entities.find((e) => e.type === 'Player')!;
				player.x = TILE_SIZE * INITIAL_PLAYER_X_TILE;
				player.y = TILE_SIZE * INITIAL_PLAYER_Y_TILE;
			});

			idCounter = maxId;
		},
		pan(state: InternalEditorState, action: PayloadAction<Point>) {
			const { x, y } = action.payload;

			const newX =
				getCurrentRoom(state).scrollOffset.x - x / getCurrentRoom(state).scale;
			const newY =
				getCurrentRoom(state).scrollOffset.y - y / getCurrentRoom(state).scale;

			const { x: lastOffsetX, y: lastOffsetY } = {
				...getCurrentRoom(state).scrollOffset,
			};

			getCurrentRoom(state).scrollOffset.x = newX;
			getCurrentRoom(state).scrollOffset.y = newY;

			const delta = {
				x: getCurrentRoom(state).scrollOffset.x - lastOffsetX,
				y: getCurrentRoom(state).scrollOffset.y - lastOffsetY,
			};

			ensurePlayerIsInView(state, delta);
		},
		selectDrag(
			state: InternalEditorState,
			action: PayloadAction<{
				bounds: Bounds;
				startingPoint: Point;
			}>
		) {
			const currentRoom = getCurrentRoom(state);
			const { bounds, startingPoint } = action.payload;

			state.isSelecting = true;

			const scaledStartingPoint = {
				x: startingPoint.x / currentRoom.scale + currentRoom.scrollOffset.x,
				y: startingPoint.y / currentRoom.scale + currentRoom.scrollOffset.y,
			};

			const tileStartingPoint = {
				x: Math.floor(scaledStartingPoint.x / TILE_SIZE),
				y: Math.floor(scaledStartingPoint.y / TILE_SIZE),
			};

			const scaledBounds = {
				upperLeft: {
					x:
						bounds.upperLeft.x / currentRoom.scale + currentRoom.scrollOffset.x,
					y:
						bounds.upperLeft.y / currentRoom.scale + currentRoom.scrollOffset.y,
				},
				lowerRight: {
					x:
						bounds.lowerRight.x / currentRoom.scale +
						currentRoom.scrollOffset.x,
					y:
						bounds.lowerRight.y / currentRoom.scale +
						currentRoom.scrollOffset.y,
				},
			};

			const tileBounds = {
				upperLeft: {
					x: Math.floor(scaledBounds.upperLeft.x / TILE_SIZE),
					y: Math.floor(scaledBounds.upperLeft.y / TILE_SIZE),
				},
				lowerRight: {
					x: Math.ceil(scaledBounds.lowerRight.x / TILE_SIZE),
					y: Math.ceil(scaledBounds.lowerRight.y / TILE_SIZE),
				},
			};

			const entityUnderStart = currentRoom.entities.find((e) => {
				const pixelBounds = getEntityPixelBounds(e);

				return pointIsInside(scaledStartingPoint, pixelBounds);
			});

			const transportUnderStart = currentRoom.transports.find((t) => {
				const pixelBounds = {
					upperLeft: { x: t.x * TILE_SIZE, y: t.y * TILE_SIZE },
					lowerRight: { x: (t.x + 1) * TILE_SIZE, y: (t.y + 1) * TILE_SIZE },
				};
				return pointIsInside(scaledStartingPoint, pixelBounds);
			});

			const tileUnderStart =
				currentRoom.tiles[tileStartingPoint.y]?.[tileStartingPoint.x];

			if (entityUnderStart || transportUnderStart || tileUnderStart) {
				const idUnderStart =
					entityUnderStart?.id ??
					transportUnderStart?.id ??
					tileUnderStart?.id ??
					0;

				const underStartAlreadyFocused = state.focused[idUnderStart];

				if (!underStartAlreadyFocused) {
					state.focused = {};
				}

				// this turned out to be a new select, not a drag
				if (Object.keys(state.focused).length === 0) {
					if (entityUnderStart) {
						state.focused[entityUnderStart.id] = true;
					}
					if (transportUnderStart) {
						state.focused[transportUnderStart.id] = true;
					}
					if (tileUnderStart) {
						state.focused[tileUnderStart.id] = true;
					}
				} else {
					// drag
					state.dragOffset = {
						x: scaledBounds.lowerRight.x - scaledBounds.upperLeft.x,
						y: scaledBounds.lowerRight.y - scaledBounds.upperLeft.y,
					};
				}
			} else {
				// select
				state.focused = {};

				currentRoom.entities.forEach((e) => {
					if (
						overlap(getEntityPixelBounds(e), scaledBounds) &&
						!nonDeletableEntityTypes.includes(e.type)
					) {
						state.focused[e.id] = true;
					}
				});

				currentRoom.transports.forEach((t) => {
					const pixelBounds = {
						upperLeft: { x: t.x * TILE_SIZE, y: t.y * TILE_SIZE },
						lowerRight: { x: (t.x + 1) * TILE_SIZE, y: (t.y + 1) * TILE_SIZE },
					};

					if (overlap(pixelBounds, scaledBounds)) {
						state.focused[t.id] = true;
					}
				});

				for (let y = tileBounds.upperLeft.y; y < tileBounds.lowerRight.y; ++y) {
					for (
						let x = tileBounds.upperLeft.x;
						x < tileBounds.lowerRight.x;
						++x
					) {
						if (currentRoom.tiles[y]?.[x]) {
							state.focused[currentRoom.tiles[y]![x]!.id] = true;
						}
					}
				}
			}
		},
		dragComplete(state: InternalEditorState) {
			const currentRoom = getCurrentRoom(state);

			if (state.dragOffset) {
				const tileXOffset = Math.round(state.dragOffset!.x / TILE_SIZE);
				const tileYOffset = Math.round(state.dragOffset!.y / TILE_SIZE);

				const spotsToClear: Point[] = [];
				const movedEntities: EditorEntity[] = [];
				const movedTransports: EditorTransport[] = [];

				let minX = currentRoom.roomTileWidth;
				let minY = currentRoom.roomTileHeight;
				let maxX = 0;
				let maxY = 0;

				// TODO: due to immer weirdness with sets, need to search by id
				// rather than entity reference (due to the refs being wrapped by proxies)
				Object.keys(state.focused).forEach((fid) => {
					const entity = currentRoom.entities.find((e) => e.id === Number(fid));

					if (entity) {
						entity.x += tileXOffset * TILE_SIZE;
						entity.y += tileYOffset * TILE_SIZE;

						// nudge it over by one so entities just above or to the left won't
						// get clobbered
						spotsToClear.push({ x: entity.x + 1, y: entity.y + 1 });
						movedEntities.push(entity);
					}

					const transport = currentRoom.transports.find(
						(t) => t.id === Number(fid)
					);
					if (transport) {
						transport.x += tileXOffset;
						transport.y += tileYOffset;
						movedTransports.push(transport);
					}

					const tile = findTile(currentRoom.tiles, Number(fid));

					if (tile) {
						currentRoom.tiles[tile.y]![tile.x] = null;
						currentRoom.tiles[tile.y + tileYOffset] =
							currentRoom.tiles[tile.y + tileYOffset] || [];
						currentRoom.tiles[tile.y + tileYOffset]![
							tile.x + tileXOffset
						] = tile;

						minX = Math.min(minX, tile.x);
						minY = Math.min(minY, tile.y);
						maxX = Math.max(maxX, tile.x);
						maxY = Math.max(maxY, tile.y);

						tile.x += tileXOffset;
						tile.y += tileYOffset;

						minX = Math.min(minX, tile.x);
						minY = Math.min(minY, tile.y);
						maxX = Math.max(maxX, tile.x);
						maxY = Math.max(maxY, tile.y);
					}
				});

				currentRoom.entities = currentRoom.entities.filter((e) => {
					if (movedEntities.includes(e)) {
						return true;
					}

					const bounds = getEntityPixelBounds(e);

					const spotToClear = spotsToClear.find((spot) => {
						return pointIsInside(spot, bounds);
					});

					return !spotToClear;
				});

				currentRoom.transports = currentRoom.transports.filter((t) => {
					if (movedTransports.includes(t)) {
						return true;
					}

					// moved a transport on top of another one? delete the one that was already there
					if (movedTransports.some((mt) => mt.x === t.x && mt.y === t.y)) {
						return false;
					}

					return true;
				});
			}

			state.dragOffset = null;
			state.isSelecting = false;
		},
		pushPan(state: InternalEditorState) {
			state.storedMouseMode = state.mouseMode;
			state.mouseMode = 'pan';
		},
		popPan(state: InternalEditorState) {
			// the draw fallback should never happen...
			state.mouseMode = state.storedMouseMode || 'draw';
		},
		toggleGrid(state: InternalEditorState) {
			state.showGrid = !state.showGrid;
		},
		clearFocusedEntity(state: InternalEditorState) {
			state.focused = {};
		},
		setTransportDestination(
			state: InternalEditorState,
			action: PayloadAction<{ id: number; room: number; x: number; y: number }>
		) {
			const { id, room, x, y } = action.payload;
			const transport = getCurrentRoom(state).transports.find(
				(t) => t.id === id
			);

			if (!transport) {
				throw new Error(
					`setTransportDestination: transport with id ${id} not found`
				);
			}

			console.log({ room, x, y });

			transport.destRoom = room;
			transport.destX = x;
			transport.destY = y;
		},
		setEntitySettings(
			state: InternalEditorState,
			action: PayloadAction<{ id: number; settings: EntitySettings }>
		) {
			const { id, settings } = action.payload;

			const entity = getCurrentRoom(state).entities.find((e) => e.id === id);

			if (entity) {
				entity.settings = {
					...entity.settings,
					...settings,
				};

				// TODO: nasty hack! this is needed due to mutating the entity just above
				// since immer is used, a new copy of the entity is created, and that breaks
				// the focused set, which is using tile/entity refs

				// remove this hack once the TileEntity work is done
				state.focused = {};
				state.focused[entity.id] = true;
			} else {
				const tile = findTile(getCurrentRoom(state).tiles, id);

				if (tile) {
					tile.settings = {
						...tile.settings,
						...settings,
					};

					// TODO: nasty hack! see above in entity section
					state.focused = {};
					selectEntireTileEntity(
						state.focused,
						getCurrentRoom(state).tiles,
						tile
					);
				}
			}
		},
	},
});

type LevelThunk = ThunkAction<void, AppState, null, Action>;

const saveLevel = (): LevelThunk => async (dispatch, getState) => {
	try {
		dispatch(editorSlice.actions.setSaveLevelState('saving'));

		const editorState = getState().editor.present;

		const levelData: LevelData = {
			rooms: editorState.rooms.map((room) => {
				return {
					settings: room.settings,
					paletteEntries: room.paletteEntries,
					entities: room.entities,
					transports: room.transports,
					tileLayer: {
						width: room.roomTileWidth,
						height: room.roomTileHeight,
						data: room.tiles,
					},
				};
			}),
		};

		const serializedLevelData = serialize(levelData);

		try {
			const createdLevelId = await saveLevelMutation(
				editorState.savedLevelId ?? null,
				editorState.metadata.name?.trim() ?? 'new level',
				'auto desc',
				serializedLevelData
			);
			dispatch(editorSlice.actions.setSavedLevelId(createdLevelId));
			dispatch(editorSlice.actions.setSaveLevelState('success'));
		} catch (e) {
			dispatch(editorSlice.actions.setSaveLevelState('error'));
		}
	} catch (e) {
		dispatch(editorSlice.actions.setSaveLevelState('error'));
	} finally {
		setTimeout(() => {
			dispatch(editorSlice.actions.setSaveLevelState('dormant'));
		}, 2000);
	}
};

const loadLevel = (id: string): LevelThunk => async (dispatch) => {
	try {
		dispatch(editorSlice.actions.setLevelDataFromLoad(EMPTY_SERIALIZED_LEVEL));
		dispatch(editorSlice.actions.setLevelName(''));
		dispatch(editorSlice.actions.setLoadLevelState('loading'));

		const result = await getLevelQuery(id);

		if (!result) {
			dispatch(editorSlice.actions.setLoadLevelState('missing'));
		} else {
			dispatch(editorSlice.actions.setLevelDataFromLoad(result.data));
			dispatch(editorSlice.actions.setLevelName(result.name));
			dispatch(editorSlice.actions.setSavedLevelId(result.id));
			dispatch(editorSlice.actions.setLoadLevelState('success'));
		}
	} catch (e) {
		dispatch(editorSlice.actions.setLoadLevelState('error'));
	}
};

// 1.0.0: first localstorage implementation
// 1.0.1: changed some tile serialization ids
// 1.1.0: added metadata.name
// 2.0.0: paletteEntries switched to just be EntityType strings
// 3.0.0: rooms
// 3.0.1: fix issue where room paletteEntries were not being restored
// 3.1.0: added room settings
const LOCALSTORAGE_KEY = 'smaghetti_3.1.0';

const loadFromLocalStorage = (): LevelThunk => (dispatch) => {
	try {
		const rawJson = window.localStorage[LOCALSTORAGE_KEY];

		if (rawJson) {
			try {
				const localStorageData = JSON.parse(rawJson) as LocalStorageData;

				if (
					localStorageData &&
					localStorageData.levelData &&
					localStorageData.levelData.rooms &&
					localStorageData.levelData.rooms[0] &&
					localStorageData.levelData.rooms[0].entities &&
					localStorageData.levelData.rooms[0].tileLayer
				) {
					dispatch(
						editorSlice.actions.setLevelDataFromLoad(localStorageData.levelData)
					);
				}

				if (localStorageData?.metadata?.name) {
					dispatch(
						editorSlice.actions.setLevelName(localStorageData.metadata.name)
					);
				}
			} catch (e) {
				console.error('loadFromLocalStorage error', e);
				dispatch(editorSlice.actions.setLoadLevelState('error'));
			}
		}
	} catch (e) {
		console.error('loadFromLocalStorage error', e);
		dispatch(editorSlice.actions.setLoadLevelState('error'));
	}
};

const saveToLocalStorage = (): LevelThunk => (dispatch, getState) => {
	try {
		dispatch(editorSlice.actions.setSaveLevelState('saving'));

		const editorState = getState().editor.present;

		const localStorageData: LevelData = {
			rooms: editorState.rooms.map((r) => {
				return {
					settings: r.settings,
					paletteEntries: r.paletteEntries,
					entities: r.entities,
					transports: r.transports,
					tileLayer: {
						width: r.roomTileWidth,
						height: r.roomTileHeight,
						data: r.tiles,
					},
				};
			}),
		};

		const serializedLevelData = serialize(localStorageData);

		const dataToWrite: LocalStorageData = {
			metadata: {
				...editorState.metadata,
			},
			levelData: serializedLevelData,
		};

		try {
			const asJson = JSON.stringify(dataToWrite);
			window.localStorage[LOCALSTORAGE_KEY] = asJson;
		} catch (e) {
			dispatch(editorSlice.actions.setSaveLevelState('error'));
		}

		dispatch(editorSlice.actions.setSaveLevelState('success'));
	} catch (e) {
		dispatch(editorSlice.actions.setSaveLevelState('error'));
	} finally {
		setTimeout(() => {
			dispatch(editorSlice.actions.setSaveLevelState('dormant'));
		}, 2000);
	}
};

const {
	setLevelName,
	setCurrentRoomIndex,
	entityDropped,
	mouseModeChanged,
	painted,
	deleteFocused,
	pan,
	selectDrag,
	dragComplete,
	resizeLevel,
	resizeLevelComplete,
	editorVisibleWindowChanged,
	scaleIncreased,
	scaleDecreased,
	toggleResizeMode,
	toggleManageRoomsMode,
	addRoom,
	deleteRoom,
	roomSettingsChange,
	toggleGrid,
	pushPan,
	popPan,
	resetOffset,
	addPaletteEntry,
	removePaletteEntry,
	setCurrentPaletteEntryByIndex,
	clearFocusedEntity,
	setEntitySettings,
	setTransportDestination,
	eraseLevel,
} = editorSlice.actions;

const reducer = editorSlice.reducer;

/**
 * a reducer that just makes sure state goes out in a clean form.
 * basically always make sure there are no tiles behind start/goal, that player
 * is not outside the bounds of the level, etc
 */
function cleanUpReducer(state: InternalEditorState, action: Action) {
	const newState = reducer(state, action);

	const nextState = produce(newState, (draftState) => {
		ensurePlayerIsInView(draftState, { x: 0, y: 0 });
		ensureLevelIsInView(draftState);

		removeOutOfBoundsTiles(draftState);
		removeOutOfBoundsEntities(draftState);
	});

	return nextState;
}

// @ts-ignore not sure why this ignore is needed...
const undoableReducer = undoable(cleanUpReducer, {
	filter: excludeAction([
		setLevelName.toString(),
		setCurrentRoomIndex.toString(),
		mouseModeChanged.toString(),
		editorVisibleWindowChanged.toString(),
		scaleIncreased.toString(),
		scaleDecreased.toString(),
		toggleResizeMode.toString(),
		toggleManageRoomsMode().toString(),
		resizeLevelComplete.toString(),
		pan.toString(),
		toggleGrid.toString(),
		resetOffset.toString(),
		addPaletteEntry.toString(),
		removePaletteEntry.toString(),
		setCurrentPaletteEntryByIndex.toString(),
		clearFocusedEntity.toString(),
		selectDrag.toString(),
		'editor/savingLevel',
		'editor/saveLevel',
		'editor/saveLevelError',
		'editor/loadLevel',
		'editor/loadingLevel',
		'editor/loadLevelError',
		'editor/setLevelDataFromLoad',
		'editor/loadFromLocalStorage',
		'editor/saveToLocalStorage',
		'@@INIT',
		'preloader/resourceLoaded',
	]),
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	groupBy(action: PayloadAction<any>, currentState: InternalEditorState) {
		if (action.type === resizeLevel.toString()) {
			return 'resize-level';
		}

		if (action.type === painted.toString()) {
			if (action.payload.newGroup) {
				return getPaintedGroup(
					action.payload.points[0],
					currentState.mouseMode
				);
			} else {
				return currentState.paintedGroup;
			}
		}

		return null;
	},
});

type EditorState = StateWithHistory<InternalEditorState> & {
	currentRoom: RoomState;
};

const { undo, redo } = ActionCreators;

/**
 * these props on editor state never get undone. They are "ephemeral" things
 * that the user would not expect to be undone, like the current zoom level.
 *
 * This approach does work, but it's a bit clunky. I think it could strongly
 * be argued this state should just not be in the slice at all. It probably
 * makes sense to move this state into <Editor /> itself, so a TODO on exploring that
 */
const NonUndoableEditorState: Array<keyof InternalEditorState> = [
	'showGrid',
	'focused',
	'mouseMode',
];

const NonUndoableRoomState: Array<keyof RoomState> = [
	'scale',
	'canIncreaseScale',
	'canDecreaseScale',
	'editorVisibleWindow',
	'scrollOffset',
	'paletteEntries',
	'currentPaletteEntry',
];

function pullForwardNonUndoableState<T>(
	state: T | undefined,
	stateToPullForward: Array<keyof T>
): Partial<T> | undefined {
	if (!state) {
		return state;
	}

	return stateToPullForward.reduce<Partial<T>>((building, key) => {
		// @ts-ignore
		building[key] = state[key];

		return building;
	}, {});
}

function neverUndoRedoCertainStateReducer(
	state: EditorState | undefined,
	action: Action
) {
	const newState = undoableReducer(state, action);

	if (
		action.type === ReduxUndoActionTypes.UNDO ||
		action.type === ReduxUndoActionTypes.REDO
	) {
		const pulledFowardRooms = newState.present.rooms.map((newRoom, i) => {
			return {
				...newRoom,
				...pullForwardNonUndoableState(
					state?.present.rooms[i],
					NonUndoableRoomState
				),
			};
		});

		const pulledForwardCurrentRoom =
			pulledFowardRooms[newState.present.currentRoomIndex];

		const finalNewState = {
			...newState,
			present: {
				...newState.present,
				...pullForwardNonUndoableState(state?.present, NonUndoableEditorState),
				rooms: pulledFowardRooms,
				currentRoom: pulledForwardCurrentRoom,
			},
		};

		return finalNewState;
	} else {
		return newState;
	}
}

function currentRoomReducer(state: EditorState | undefined, action: Action) {
	const newState = neverUndoRedoCertainStateReducer(state, action);

	return {
		...newState,
		currentRoom: newState.present.rooms[newState.present.currentRoomIndex],
	};
}

export type {
	EditorState,
	InternalEditorState,
	EditorFocusRect,
	MouseMode,
	RoomState,
};

export {
	currentRoomReducer as reducer,
	undo,
	redo,
	setLevelName,
	setCurrentRoomIndex,
	entityDropped,
	mouseModeChanged,
	painted,
	deleteFocused,
	pan,
	selectDrag,
	dragComplete,
	resizeLevel,
	resizeLevelComplete,
	editorVisibleWindowChanged,
	scaleIncreased,
	scaleDecreased,
	toggleResizeMode,
	toggleManageRoomsMode,
	addRoom,
	deleteRoom,
	roomSettingsChange,
	toggleGrid,
	pushPan,
	popPan,
	resetOffset,
	addPaletteEntry,
	removePaletteEntry,
	setCurrentPaletteEntryByIndex,
	clearFocusedEntity,
	setEntitySettings,
	setTransportDestination,
	saveLevel,
	loadLevel,
	loadFromLocalStorage,
	saveToLocalStorage,
	eraseLevel,
	LOCALSTORAGE_KEY,
};
