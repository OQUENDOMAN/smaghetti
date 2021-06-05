import {
	createSlice,
	Action,
	PayloadAction,
	ThunkDispatch,
} from '@reduxjs/toolkit';
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
	INITIAL_ROOM_TILE_HEIGHT,
	INITIAL_ROOM_TILE_WIDTH,
	INITIAL_PLAYER_Y_TILE,
	INITIAL_PLAYER_X_TILE,
} from './constants';
import { getPlayerScaleFromWindow } from '../../util/getPlayerScaleFromWindow';
import { saveLevel as saveLevelMutation } from '../../remoteData/saveLevel';
import { getLevel as getLevelQuery } from '../../remoteData/getLevel';
import { serialize } from '../../level/serialize';
import { deserialize } from '../../level/deserialize';
import isEqual from 'lodash/isEqual';
import cloneDeep from 'lodash/cloneDeep';

import { TILE_SIZE } from '../../tiles/constants';
import { entityMap, EntityType } from '../../entities/entityMap';
import { ROOM_BACKGROUND_SETTINGS } from '../../levelData/constants';
import {
	determineValidGraphicAndObjectSetValues,
	isGraphicAndObjectSetCompatible,
	isWorkingEntityType,
} from '../../entities/util';
import { getExampleLevel } from '../FileLoader/files';
import {
	convertLevelToLatestVersion,
	CURRENT_VERSION,
} from '../../level/versioning/convertLevelToLatestVersion';

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

type EditorRoomLayer = RoomLayer & {
	locked: boolean;
};

type RoomState = {
	settings: RoomSettings;
	actors: EditorRoomLayer;
	stage: EditorRoomLayer;
	roomTileWidth: number;
	roomTileHeight: number;
	paletteEntries: EntityType[];
	validEntityTypes: EntityType[];
	scale: number;
	canIncreaseScale: boolean;
	canDecreaseScale: boolean;
	editorVisibleWindow: EditorFocusRect;
	scrollOffset: Point;
	currentPaletteEntry?: EntityType;
};

type InternalEditorState = {
	name: string;
	settings: {
		timer: number;
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
	storedForManageLevelMode?: {
		scale: number;
		offset: Point;
		mouseMode: MouseMode;
	} | null;

	mouseMode: MouseMode;
	pendingLevelResizeIncrement: Point;
	showGrid: boolean;
	focused: Record<number, boolean>;
	dragOffset: Point | null;
	isSelecting: boolean;
	savedLevelId?: string;
	saveLevelState: 'dormant' | 'saving' | 'error' | 'success';
	loadLevelState:
		| 'dormant'
		| 'loading'
		| 'error'
		| 'missing'
		| 'success'
		| 'legacy';
};

const initialScale = playerScale;

/**
 * When a room gets deleted, this function patches up transports
 * Any entities with a destination of the deleted room get removed
 * any entities whose destination was above the deleted room, get the index bumped down
 */
type TransDest = {
	room: number;
	x: number;
	y: number;
};

function resetState(state: InternalEditorState) {
	Object.keys(state).forEach((key) => {
		// @ts-ignore
		state[key as keyof InternalEditorState] = cloneDeep(
			initialState[key as keyof InternalEditorState]
		);
	});
}

function fixTransportsForEntities(
	entities: EditorEntity[],
	deletedRoomIndex: number
): EditorEntity[] {
	return entities.reduce<EditorEntity[]>((building, e) => {
		if (
			!e.settings ||
			!e.settings.destination ||
			(e.settings.destination as TransDest).room !== deletedRoomIndex
		) {
			building = building.concat(e);

			if (e.settings?.destination?.room > deletedRoomIndex) {
				e.settings!.destination!.room -= 1;
			}
		}

		return building;
	}, []);
}

function fixTransports(rooms: RoomState[], deletedIndex: number) {
	rooms.forEach((room) => {
		room.actors.entities = fixTransportsForEntities(
			room.actors.entities,
			deletedIndex
		);
		room.stage.entities = fixTransportsForEntities(
			room.stage.entities,
			deletedIndex
		);
	});
}

function isWorkingEditorEntity(e: EditorEntity): boolean {
	if (e.type === 'Player') {
		return true;
	}

	return isWorkingEntityType(e.type);
}

function filterNonWorkingFromEntities(es: EditorEntity[]): EditorEntity[] {
	return es.filter(isWorkingEditorEntity);
}

function filterNonWorkingFromMatrix(m: EditorEntityMatrix): EditorEntityMatrix {
	return m.map((row) => {
		if (!row) {
			return row;
		}

		return row.map((cell) => {
			if (!cell || isWorkingEditorEntity(cell)) {
				return cell;
			}

			return null;
		});
	});
}

function filterIncompatibleFromEntities(
	es: EditorEntity[],
	validEntityTypes: EntityType[]
): EditorEntity[] {
	return es.filter((e) => validEntityTypes.includes(e.type));
}

function filterIncompatibleFromMatrix(
	m: EditorEntityMatrix,
	validEntityTypes: EntityType[]
): EditorEntityMatrix {
	return m.map((row) => {
		if (!row) {
			return row;
		}

		return row.map((cell) => {
			if (!cell || validEntityTypes.includes(cell.type)) {
				return cell;
			}

			return null;
		});
	});
}

function getCurrentRoom(state: InternalEditorState): RoomState {
	return state.rooms[state.currentRoomIndex];
}

function isEditable(layer: EditorRoomLayer): boolean {
	return !layer.locked;
}

function unfocusEntities(
	focused: Record<number, boolean>,
	entities: EditorEntity[]
) {
	entities.forEach((e) => {
		focused[e.id] = false;
	});
}

function unfocusMatrix(
	focused: Record<number, boolean>,
	matrix: EditorEntityMatrix
) {
	matrix.forEach((row) => {
		if (row) {
			row.forEach((cell) => {
				if (cell) {
					focused[cell.id] = false;
				}
			});
		}
	});
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

	const levelHeight = INITIAL_ROOM_TILE_HEIGHT * TILE_SIZE * initialScale;
	const windowHeight = window.innerHeight;

	return (levelHeight - windowHeight) / initialScale;
}

let idCounter = 10;

const SINGLE_BRICK_SO_PLAYER_DOESNT_FALL: EditorEntityMatrix = (function () {
	const rows = [];
	for (let y = 0; y < INITIAL_PLAYER_Y_TILE + 1; ++y) {
		rows.push(null);
	}

	const playerRow = [];
	for (let x = 0; x < INITIAL_PLAYER_X_TILE; ++x) {
		playerRow.push(null);
	}

	playerRow.push({
		id: idCounter++,
		type: 'IndestructibleBrick',
		x: INITIAL_PLAYER_X_TILE,
		y: INITIAL_PLAYER_Y_TILE + 1,
	} as const);

	rows.push(playerRow);

	while (rows.length < INITIAL_ROOM_TILE_HEIGHT) {
		rows.push(null);
	}

	return rows;
})();

const initialRoomState: RoomState = {
	settings: {
		// TODO: figure out how to handle music
		music: 0xd, // this is the underground music
		...ROOM_BACKGROUND_SETTINGS.underground,
	},
	actors: {
		entities: [
			{
				id: 1,
				x: TILE_SIZE * INITIAL_PLAYER_X_TILE,
				y: TILE_SIZE * INITIAL_PLAYER_Y_TILE,
				type: 'Player',
			},
		],
		matrix: [],
		locked: false,
	},
	stage: {
		entities: [],
		matrix: cloneDeep(SINGLE_BRICK_SO_PLAYER_DOESNT_FALL),
		locked: false,
	},
	roomTileWidth: INITIAL_ROOM_TILE_WIDTH,
	roomTileHeight: INITIAL_ROOM_TILE_HEIGHT,
	scale: initialScale,
	canIncreaseScale: scales.indexOf(initialScale) < scales.length - 1,
	canDecreaseScale: scales.indexOf(initialScale) > 0,
	editorVisibleWindow: {
		offset: { x: 0, y: 0 },
		width: 0,
		height: 0,
	},
	scrollOffset: { x: 0, y: calcYForScrollToBottom() },
	paletteEntries: [
		'Brick',
		'Coin',
		'Goomba',
		'QuestionBlock',
		'GreenKoopaTroopa',
		'Chest',
		'CardSlotMachine',
		'PSwitch',
	],
	validEntityTypes: ((entityMap && Object.keys(entityMap)) ||
		[]) as EntityType[],
	currentPaletteEntry: 'Brick',
};

const defaultInitialState: InternalEditorState = {
	name: 'new level',
	settings: {
		timer: 900,
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
	settings: {
		timer: 900,
	},
	rooms: [
		{
			settings: { ...initialRoomState.settings },
			actors: {
				...initialState.rooms[0].actors,
				matrix: [],
				matrixSettings: [],
			},
			stage: {
				...initialState.rooms[0].actors,
				matrix: [],
				matrixSettings: [],
			},
			paletteEntries: [...initialRoomState.paletteEntries],
			roomTileHeight: INITIAL_ROOM_TILE_HEIGHT,
			roomTileWidth: INITIAL_ROOM_TILE_WIDTH,
		},
	],
};

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
	matrix: EditorEntityMatrix,
	floodCellType: EntityType,
	indexX: number,
	indexY: number,
	levelTileWidth: number,
	levelTileHeight: number
): FloodBounds {
	const targetCell = matrix[indexY]?.[indexX];
	const targetType = targetCell?.type ?? 0;

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

		const cellAtPoint = matrix[point.y]?.[point.x];

		let exploreNeighbors = false;

		if (cellAtPoint) {
			if (cellAtPoint.type === targetType) {
				cellAtPoint.type = floodCellType;
				exploreNeighbors = true;
			}
		} else if (targetType === 0) {
			matrix[point.y] = matrix[point.y] || [];
			matrix[point.y]![point.x] = {
				id: idCounter++,
				x: point.x,
				y: point.y,
				type: floodCellType,
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

function getEntityTileBounds(entity: NewEditorEntity): Bounds {
	const entityDef = entityMap[entity.type];
	const tileWidth = entity.settings?.width ?? entityDef.width ?? 1;
	const tileHeight = entity.settings?.height ?? entityDef.height ?? 1;

	const minX = Math.floor(entity.x / TILE_SIZE);
	const minY = Math.floor(entity.y / TILE_SIZE);

	const maxX = minX + tileWidth - 1;
	const maxY = minY + tileHeight - 1;

	return {
		upperLeft: { x: minX, y: minY },
		lowerRight: { x: maxX, y: maxY },
	};
}

function getEntityPixelBounds(entity: NewEditorEntity): Bounds {
	const tileBounds = getEntityTileBounds(entity);

	return {
		upperLeft: {
			x: tileBounds.upperLeft.x * TILE_SIZE,
			y: tileBounds.upperLeft.y * TILE_SIZE,
		},
		lowerRight: {
			x: tileBounds.lowerRight.x * TILE_SIZE + TILE_SIZE,
			y: tileBounds.lowerRight.y * TILE_SIZE + TILE_SIZE,
		},
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

function snapEntityCoordToGrid(inputX: number): number {
	return Math.floor(inputX / TILE_SIZE) * TILE_SIZE;
}

// function ensurePlayerIsInView(state: InternalEditorState, offsetDelta: Point) {
// 	const player = getCurrentRoom(state).entities.find(
// 		(e) => e.type === 'Player'
// 	)!;
//
// 	player.x = clamp(
// 		player.x + offsetDelta.x,
// 		0,
// 		(getCurrentRoom(state).roomTileWidth - 1) * TILE_SIZE
// 	);
// 	player.y = clamp(
// 		player.y + offsetDelta.y,
// 		0,
// 		(getCurrentRoom(state).roomTileHeight - 1) * TILE_SIZE
// 	);
// }

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
	const currentRoom = getCurrentRoom(state);

	const levelBounds = {
		upperLeft: { x: 0, y: 0 },
		lowerRight: {
			x: currentRoom.roomTileWidth * TILE_SIZE,
			y: currentRoom.roomTileHeight * TILE_SIZE,
		},
	};

	currentRoom.actors.entities = currentRoom.actors.entities.filter((e) => {
		if (nonDeletableEntityTypes.includes(e.type)) {
			return true;
		}

		const pixelBounds = getEntityPixelBounds(e);

		return overlap(pixelBounds, levelBounds);
	});
}

function removeOutOfBoundsCells(state: InternalEditorState) {
	const currentRoom = getCurrentRoom(state);

	currentRoom.stage.matrix = currentRoom.stage.matrix.map((row) => {
		return row?.slice(0, currentRoom.roomTileWidth) ?? null;
	});

	currentRoom.stage.matrix = currentRoom.stage.matrix.slice(
		0,
		currentRoom.roomTileHeight
	);
}

function scaleTo(state: InternalEditorState, newScale: number) {
	const currentRoom = getCurrentRoom(state);

	const newScaleIndex = scales.indexOf(newScale);

	currentRoom.scale = newScale;
	currentRoom.canIncreaseScale =
		newScaleIndex !== -1 && newScaleIndex < scales.length - 1;
	currentRoom.canDecreaseScale = newScaleIndex !== -1 && newScaleIndex > 0;
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

function setScaleAndOffsetForManageLevel(state: InternalEditorState) {
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

function findCellEntity(
	matrix: EditorEntityMatrix,
	id: number
): EditorEntity | null {
	for (let y = 0; y < matrix.length; ++y) {
		for (let x = 0; !!matrix[y] && x < matrix[y]!.length; ++x) {
			if (matrix[y]![x]?.id === id) {
				return matrix[y]![x];
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
		return building.concat(room.actors.entities, room.stage.entities);
	}, []);

	const hasBubbleWithAceCoin = allEntities.some(
		(e) => e.type === 'Bubble' && e.settings?.payload === 'AceCoin'
	);

	let aceCoinIndex = hasBubbleWithAceCoin ? 1 : 0;

	const aceCoins = allEntities.filter((e) => e.type === 'AceCoin');

	aceCoins.forEach((ac) => {
		ac.settings = { aceCoinIndex };
		aceCoinIndex += 1;
	});
}

function updateValidEntityTypes(room: RoomState) {
	const stageCells = room.stage.matrix.reduce<EditorEntity[]>(
		(building, row) => {
			if (!row) {
				return building;
			}

			const rowSpriteCells = row.reduce<EditorEntity[]>((rowBuilding, cell) => {
				if (!cell) {
					return rowBuilding;
				}

				return rowBuilding.concat(cell);
			}, []);

			return building.concat(rowSpriteCells);
		},
		[]
	);

	const actorCells = room.actors.matrix.reduce<EditorEntity[]>(
		(building, row) => {
			if (!row) {
				return building;
			}

			const rowSpriteCells = row.reduce<EditorEntity[]>((rowBuilding, cell) => {
				if (!cell) {
					return rowBuilding;
				}

				return rowBuilding.concat(cell);
			}, []);

			return building.concat(rowSpriteCells);
		},
		[]
	);

	const allEntities = room.actors.entities.concat(
		actorCells,
		stageCells,
		room.stage.entities
	);

	if (allEntities.length === 0) {
		room.validEntityTypes = Object.keys(entityMap) as EntityType[];
	} else {
		const currentGraphicAndObjectSetNumbers = determineValidGraphicAndObjectSetValues(
			allEntities.map((e) => entityMap[e.type])
		);

		room.validEntityTypes = Object.keys(entityMap).filter((type) => {
			const def = entityMap[type as EntityType];
			return isGraphicAndObjectSetCompatible(
				def,
				currentGraphicAndObjectSetNumbers
			);
		}) as EntityType[];
	}

	room.paletteEntries = room.paletteEntries.filter((pe) =>
		room.validEntityTypes.includes(pe)
	);

	// possibly entities in the room are invalid, this can happen if a change
	// to the editor happened that introduced a new incompatibility that didn't exist
	// before. Need to filter those out
	room.actors.matrix = filterIncompatibleFromMatrix(
		room.actors.matrix,
		room.validEntityTypes
	);
	room.actors.entities = filterIncompatibleFromEntities(
		room.actors.entities,
		room.validEntityTypes
	);
	room.stage.matrix = filterIncompatibleFromMatrix(
		room.stage.matrix,
		room.validEntityTypes
	);
	room.stage.entities = filterIncompatibleFromEntities(
		room.stage.entities,
		room.validEntityTypes
	);
}

function eraseAt(layer: EditorRoomLayer, tilePoint: Point) {
	if (!isEditable(layer)) {
		return;
	}

	const existingEntity = layer.entities.find((e) => {
		return pointIsInside(tilePoint, getEntityTileBounds(e));
	});

	if (
		existingEntity &&
		!nonDeletableEntityTypes.includes(existingEntity.type)
	) {
		layer.entities = layer.entities.filter((e) => e !== existingEntity);
	}

	if (layer.matrix[tilePoint.y]) {
		layer.matrix[tilePoint.y]![tilePoint.x] = null;
	}
}

function drawAt(layer: EditorRoomLayer, { x, y }: Point, type: EntityType) {
	if (!isEditable(layer)) {
		return;
	}

	const entityDef = entityMap[type];

	if (entityDef.editorType === 'cell') {
		const existingTile = layer.matrix[y]?.[x];

		if (existingTile) {
			existingTile.type = type;
		} else {
			// paint a new tile
			layer.matrix[y] = layer.matrix[y] || [];
			layer.matrix[y]![x] = {
				id: idCounter++,
				x,
				y,
				type,
			};

			if (entityDef.settingsType === 'single') {
				layer.matrix[y]![x]!.settings = {
					...entityDef.defaultSettings,
				};
			}
		}
	} else if (entityDef.editorType === 'entity') {
		const newEntity: NewEditorEntity = {
			x: x * TILE_SIZE,
			y: y * TILE_SIZE,
			type,
			settings: entityDef.defaultSettings
				? { ...entityDef.defaultSettings }
				: undefined,
		};

		if (
			canDrop(newEntity, layer.entities) &&
			(type !== 'AceCoin' ||
				layer.entities.filter((e) => e.type === 'AceCoin').length < 5)
		) {
			const completeEntity: EditorEntity = {
				...newEntity,
				id: idCounter++,
			};

			layer.entities.push(completeEntity);
		}
	}
}

function fillAt(
	layer: EditorRoomLayer,
	{ x, y }: Point,
	type: EntityType,
	tileWidth: number,
	tileHeight: number
) {
	if (!isEditable(layer) || entityMap[type].editorType !== 'cell') {
		return;
	}

	floodFill(layer.matrix, type, x, y, tileWidth, tileHeight);
}

const editorSlice = createSlice({
	name: 'editor',
	initialState,
	reducers: {
		setLevelName(state: InternalEditorState, action: PayloadAction<string>) {
			state.name = action.payload;
		},
		setTimer(state: InternalEditorState, action: PayloadAction<number>) {
			const newTimer = action.payload;
			state.settings.timer = Math.min(Math.max(0, newTimer), 999);
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

			currentRoom.paletteEntries = currentRoom.paletteEntries.filter(
				(p) => p !== newEntry
			);

			currentRoom.paletteEntries.unshift(newEntry);
			currentRoom.currentPaletteEntry = currentRoom.paletteEntries[0];
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
			const currentRoom = getCurrentRoom(state);

			if (!canDrop(action.payload, getCurrentRoom(state).actors.entities)) {
				return;
			}

			if ('id' in action.payload) {
				const { id } = action.payload;
				const entity = currentRoom.actors.entities.find((e) => e.id === id);

				if (entity) {
					Object.assign(entity, action.payload, {
						x: snapEntityCoordToGrid(action.payload.x),
						y: snapEntityCoordToGrid(action.payload.y),
					});
				}
			} else {
				currentRoom.actors.entities.push({
					...action.payload,
					x: snapEntityCoordToGrid(action.payload.x),
					y: snapEntityCoordToGrid(action.payload.y),
					id: idCounter++,
				});
			}
		},
		painted(
			state: InternalEditorState,
			action: PayloadAction<{ points: Point[]; newGroup: boolean }>
		) {
			const currentRoom = getCurrentRoom(state);
			const { points, newGroup } = action.payload;
			let currentLayer: EditorRoomLayer | null = null;

			if (currentRoom.currentPaletteEntry) {
				currentLayer =
					entityMap[currentRoom.currentPaletteEntry].layer === 'stage'
						? currentRoom.stage
						: currentRoom.actors;
			}

			if (newGroup) {
				state.paintedGroup = getPaintedGroup(points[0], state.mouseMode);
			}

			points.forEach((point) => {
				const tilePoint = {
					x: Math.floor(point.x / TILE_SIZE),
					y: Math.floor(point.y / TILE_SIZE),
				};

				switch (state.mouseMode) {
					case 'erase': {
						eraseAt(currentRoom.actors, tilePoint);
						eraseAt(currentRoom.stage, tilePoint);
						break;
					}
					case 'draw': {
						drawAt(currentLayer!, tilePoint, currentRoom.currentPaletteEntry!);
						break;
					}
					case 'fill': {
						fillAt(
							currentLayer!,
							tilePoint,
							currentRoom.currentPaletteEntry!,
							currentRoom.roomTileWidth,
							currentRoom.roomTileHeight
						);
						break;
					}
				}
			});

			updateValidEntityTypes(currentRoom);
			assignAceCoinIndices(state.rooms);
		},
		deleteFocused(state: InternalEditorState) {
			const currentRoom = getCurrentRoom(state);

			// technically the isEditable checks are not needed, as if the layer is not editable then nothing in it should
			// be focused, but it doesn't hurt to double up here

			if (isEditable(currentRoom.actors)) {
				currentRoom.actors.entities = currentRoom.actors.entities.filter(
					(e) => {
						return (
							nonDeletableEntityTypes.includes(e.type) || !state.focused[e.id]
						);
					}
				);
			}

			if (isEditable(currentRoom.stage)) {
				currentRoom.stage.matrix = currentRoom.stage.matrix.map((row) => {
					if (!row) {
						return null;
					}

					return row.map((t) => {
						if (!t) {
							return t;
						}

						if (state.focused[t.id]) {
							return null;
						} else {
							return t;
						}
					});
				});
			}

			state.focused = {};

			assignAceCoinIndices(state.rooms);
			updateValidEntityTypes(currentRoom);
		},
		mouseModeChanged(
			state: InternalEditorState,
			action: PayloadAction<MouseMode>
		) {
			const currentRoom = getCurrentRoom(state);

			if (
				(currentRoom.currentPaletteEntry &&
					entityMap[currentRoom.currentPaletteEntry].layer !== 'actor') ||
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
			resetState(state);
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
		toggleManageLevelMode(state: InternalEditorState) {
			const currentRoom = getCurrentRoom(state);

			if (state.storedForManageLevelMode) {
				scaleTo(state, state.storedForManageLevelMode.scale);
				currentRoom.scrollOffset = state.storedForManageLevelMode.offset;
				state.mouseMode = state.storedForManageLevelMode.mouseMode;

				state.storedForManageLevelMode = null;
			} else {
				state.storedForManageLevelMode = {
					scale: currentRoom.scale,
					offset: { ...currentRoom.scrollOffset },
					mouseMode: state.mouseMode,
				};

				setScaleAndOffsetForManageLevel(state);
				state.mouseMode = 'pan';
			}
		},
		addRoom(state: InternalEditorState) {
			if (state.rooms.length < 4) {
				state.rooms.push(cloneDeep(initialRoomState));
				setScaleAndOffsetForManageLevel(state);
			}
		},
		deleteRoom(state: InternalEditorState, action: PayloadAction<number>) {
			if (state.rooms.length > 1) {
				const deletedIndex = action.payload;
				const deletedRoom = state.rooms[deletedIndex];
				state.rooms = state.rooms.filter((r) => r !== deletedRoom);
				state.currentRoomIndex = Math.min(
					state.currentRoomIndex,
					state.rooms.length - 1
				);

				fixTransports(state.rooms, deletedIndex);

				setScaleAndOffsetForManageLevel(state);
			}
		},
		roomSettingsChange(
			state: InternalEditorState,
			action: PayloadAction<{ index: number; settings: Partial<RoomSettings> }>
		) {
			const { index, settings } = action.payload;
			const room = state.rooms[index];
			room.settings = { ...room.settings, ...settings };
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
			resetState(state);

			const { levelData, maxId } = deserialize(action.payload);

			state.settings = levelData.settings;
			state.rooms = levelData.rooms.map((r) => {
				return {
					settings: r.settings,
					actors: {
						...r.actors,
						matrix: filterNonWorkingFromMatrix(r.actors.matrix),
						entities: filterNonWorkingFromEntities(r.actors.entities),
						locked: false,
					},
					stage: {
						...r.stage,
						matrix: filterNonWorkingFromMatrix(r.stage.matrix),
						entities: filterNonWorkingFromEntities(r.stage.entities),
						locked: false,
					},
					roomTileHeight: r.roomTileHeight,
					roomTileWidth: r.roomTileWidth,
					scale: initialScale,
					canIncreaseScale: scales.indexOf(initialScale) < scales.length - 1,
					canDecreaseScale: scales.indexOf(initialScale) > 0,
					editorVisibleWindow: {
						offset: { x: 0, y: 0 },
						width: 0,
						height: 0,
					},
					scrollOffset: { x: 0, y: calcYForScrollToBottom() },
					paletteEntries: r.paletteEntries,
					validEntityTypes: [],
					currentPaletteEntry: r.paletteEntries[0],
				};
			});

			state.rooms.forEach((r) => {
				const player = r.actors.entities.find((e) => e.type === 'Player')!;
				player.x = TILE_SIZE * INITIAL_PLAYER_X_TILE;
				player.y = TILE_SIZE * INITIAL_PLAYER_Y_TILE;
				updateValidEntityTypes(r);
			});

			idCounter = maxId;

			assignAceCoinIndices(state.rooms);
		},
		pan(state: InternalEditorState, action: PayloadAction<Point>) {
			const currentRoom = getCurrentRoom(state);

			const { x, y } = action.payload;

			const newX = currentRoom.scrollOffset.x - x / currentRoom.scale;
			const newY = currentRoom.scrollOffset.y - y / currentRoom.scale;

			currentRoom.scrollOffset.x = newX;
			currentRoom.scrollOffset.y = newY;
		},
		// TODO: this is nuts now with actors/stage, was pretty nuts before that too
		selectDrag(
			state: InternalEditorState,
			action: PayloadAction<{
				bounds: Bounds;
				startingPoint: Point;
			}>
		) {
			if (state.mouseMode !== 'select') {
				return;
			}

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

			const actorEntityUnderStart = !isEditable(currentRoom.actors)
				? null
				: currentRoom.actors.entities.find((e) => {
						// temp hack: don't allow dragging the player until player location
						// is taken into account when creating the gba level
						if (e.type === 'Player') {
							return false;
						}

						const pixelBounds = getEntityPixelBounds(e);

						return pointIsInside(scaledStartingPoint, pixelBounds);
				  });

			const stageEntityUnderStart = !isEditable(currentRoom.stage)
				? null
				: currentRoom.stage.entities.find((e) => {
						// temp hack: don't allow dragging the player until player location
						// is taken into account when creating the gba level
						if (e.type === 'Player') {
							return false;
						}

						const pixelBounds = getEntityPixelBounds(e);

						return pointIsInside(scaledStartingPoint, pixelBounds);
				  });

			const actorTileUnderStart = !isEditable(currentRoom.actors)
				? null
				: currentRoom.actors.matrix[tileStartingPoint.y]?.[tileStartingPoint.x];

			const stageTileUnderStart = !isEditable(currentRoom.stage)
				? null
				: currentRoom.stage.matrix[tileStartingPoint.y]?.[tileStartingPoint.x];

			const idUnderStart =
				actorEntityUnderStart?.id ??
				stageEntityUnderStart?.id ??
				stageTileUnderStart?.id ??
				actorTileUnderStart?.id ??
				0;

			if (idUnderStart) {
				const underStartAlreadyFocused = state.focused[idUnderStart];

				if (!underStartAlreadyFocused) {
					state.focused = {};
				}

				// this turned out to be a new select, not a drag
				if (Object.keys(state.focused).length === 0) {
					if (actorEntityUnderStart) {
						state.focused[actorEntityUnderStart.id] = true;
					}
					if (stageEntityUnderStart) {
						state.focused[stageEntityUnderStart.id] = true;
					}
					if (stageTileUnderStart) {
						state.focused[stageTileUnderStart.id] = true;
					}
					if (actorTileUnderStart) {
						state.focused[actorTileUnderStart.id] = true;
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

				if (isEditable(currentRoom.actors)) {
					currentRoom.actors.entities.forEach((e) => {
						if (
							overlap(getEntityPixelBounds(e), scaledBounds) &&
							!nonDeletableEntityTypes.includes(e.type)
						) {
							state.focused[e.id] = true;
						}
					});

					for (
						let y = tileBounds.upperLeft.y;
						y < tileBounds.lowerRight.y;
						++y
					) {
						for (
							let x = tileBounds.upperLeft.x;
							x < tileBounds.lowerRight.x;
							++x
						) {
							if (currentRoom.actors.matrix[y]?.[x]) {
								state.focused[currentRoom.actors.matrix[y]![x]!.id] = true;
							}
						}
					}
				}

				if (isEditable(currentRoom.stage)) {
					currentRoom.stage.entities.forEach((e) => {
						if (
							overlap(getEntityPixelBounds(e), scaledBounds) &&
							!nonDeletableEntityTypes.includes(e.type)
						) {
							state.focused[e.id] = true;
						}
					});

					for (
						let y = tileBounds.upperLeft.y;
						y < tileBounds.lowerRight.y;
						++y
					) {
						for (
							let x = tileBounds.upperLeft.x;
							x < tileBounds.lowerRight.x;
							++x
						) {
							if (currentRoom.stage.matrix[y]?.[x]) {
								state.focused[currentRoom.stage.matrix[y]![x]!.id] = true;
							}
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

				const actorSpotsToClear: Point[] = [];
				const stageSpotsToClear: Point[] = [];
				const movedEntities: EditorEntity[] = [];

				Object.keys(state.focused).forEach((fid) => {
					const actorEntity = currentRoom.actors.entities.find(
						(e) => e.id === Number(fid)
					);

					if (actorEntity) {
						actorEntity.x += tileXOffset * TILE_SIZE;
						actorEntity.y += tileYOffset * TILE_SIZE;

						// nudge it over by one so entities just above or to the left won't
						// get clobbered
						actorSpotsToClear.push({
							x: actorEntity.x + 1,
							y: actorEntity.y + 1,
						});
						movedEntities.push(actorEntity);
					}

					const stageEntity = currentRoom.stage.entities.find(
						(e) => e.id === Number(fid)
					);

					if (stageEntity) {
						stageEntity.x += tileXOffset * TILE_SIZE;
						stageEntity.y += tileYOffset * TILE_SIZE;

						// nudge it over by one so entities just above or to the left won't
						// get clobbered
						stageSpotsToClear.push({
							x: stageEntity.x + 1,
							y: stageEntity.y + 1,
						});
						movedEntities.push(stageEntity);
					}

					const stageCell = findCellEntity(
						currentRoom.stage.matrix,
						Number(fid)
					);

					if (stageCell) {
						currentRoom.stage.matrix[stageCell.y]![stageCell.x] = null;
						currentRoom.stage.matrix[stageCell.y + tileYOffset] =
							currentRoom.stage.matrix[stageCell.y + tileYOffset] || [];
						currentRoom.stage.matrix[stageCell.y + tileYOffset]![
							stageCell.x + tileXOffset
						] = stageCell;

						stageCell.x += tileXOffset;
						stageCell.y += tileYOffset;
					}

					const actorCell = findCellEntity(
						currentRoom.actors.matrix,
						Number(fid)
					);

					if (actorCell) {
						currentRoom.actors.matrix[actorCell.y]![actorCell.x] = null;
						currentRoom.actors.matrix[actorCell.y + tileYOffset] =
							currentRoom.actors.matrix[actorCell.y + tileYOffset] || [];
						currentRoom.actors.matrix[actorCell.y + tileYOffset]![
							actorCell.x + tileXOffset
						] = actorCell;

						actorCell.x += tileXOffset;
						actorCell.y += tileYOffset;
					}
				});

				currentRoom.actors.entities = currentRoom.actors.entities.filter(
					(e) => {
						if (movedEntities.includes(e)) {
							return true;
						}

						const bounds = getEntityPixelBounds(e);

						const spotToClear = actorSpotsToClear.find((spot) => {
							return pointIsInside(spot, bounds);
						});

						return !spotToClear;
					}
				);

				currentRoom.stage.entities = currentRoom.stage.entities.filter((e) => {
					if (movedEntities.includes(e)) {
						return true;
					}

					const bounds = getEntityPixelBounds(e);

					const spotToClear = stageSpotsToClear.find((spot) => {
						return pointIsInside(spot, bounds);
					});

					return !spotToClear;
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
		toggleLayerLock(
			state: InternalEditorState,
			action: PayloadAction<'actors' | 'stage'>
		) {
			const currentRoom = getCurrentRoom(state);

			if (action.payload === 'actors') {
				currentRoom.actors.locked = !currentRoom.actors.locked;
				unfocusEntities(state.focused, currentRoom.actors.entities);
			} else {
				currentRoom.stage.locked = !currentRoom.stage.locked;
				unfocusMatrix(state.focused, currentRoom.stage.matrix);
			}
		},
		clearFocusedEntity(state: InternalEditorState) {
			state.focused = {};
		},
		setEntitySettings(
			state: InternalEditorState,
			action: PayloadAction<{ id: number; settings: EditorEntitySettings }>
		) {
			const currentRoom = getCurrentRoom(state);

			const { id, settings } = action.payload;

			const entity =
				currentRoom.actors.entities.find((e) => e.id === id) ??
				currentRoom.stage.entities.find((e) => e.id === id);

			if (entity) {
				entity.settings = {
					...entity.settings,
					...settings,
				};

				// possibly the bubble just added an ace coin
				if (entity.type === 'Bubble') {
					assignAceCoinIndices(state.rooms);
				}
			} else {
				const cell =
					findCellEntity(currentRoom.stage.matrix, id) ??
					findCellEntity(currentRoom.actors.matrix, id);

				if (cell) {
					cell.settings = {
						...cell.settings,
						...settings,
					};
				}
			}
		},
	},
});

type LevelThunk = ThunkAction<void, AppState, null, Action>;

async function doSave(
	dispatch: ThunkDispatch<AppState, null, Action>,
	levelData: LevelData,
	id: string | undefined,
	name: string | undefined
) {
	try {
		dispatch(editorSlice.actions.setSaveLevelState('saving'));
		const serializedLevelData = serialize(levelData);

		try {
			const createdLevelId = await saveLevelMutation(
				id ?? null,
				name ?? 'new level',
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
}

const saveLevel = (): LevelThunk => async (dispatch, getState) => {
	const editorState = getState().editor.present;

	const levelData: LevelData = {
		settings: editorState.settings,
		rooms: editorState.rooms.map((r) => {
			const { validEntityTypes, ...restOfRoom } = r;
			return restOfRoom;
		}),
	};

	await doSave(dispatch, levelData, editorState.savedLevelId, editorState.name);
};

const saveLevelCopy = (): LevelThunk => async (dispatch, getState) => {
	const editorState = getState().editor.present;

	const levelData: LevelData = {
		settings: editorState.settings,
		rooms: editorState.rooms.map((r) => {
			const { validEntityTypes, ...restOfRoom } = r;
			return restOfRoom;
		}),
	};

	const levelName = (editorState.name ?? 'new level') + ' copy';
	await doSave(dispatch, levelData, undefined, levelName);

	dispatch(editorSlice.actions.setLevelName(levelName));
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
			const convertedLevel = convertLevelToLatestVersion(result);

			if (!convertedLevel) {
				dispatch(editorSlice.actions.setLoadLevelState('error'));
			} else {
				dispatch(editorSlice.actions.setLevelDataFromLoad(convertedLevel.data));
				dispatch(editorSlice.actions.setLevelName(result.name));
				dispatch(editorSlice.actions.setSavedLevelId(result.id));
				dispatch(editorSlice.actions.setLoadLevelState('success'));
			}
		}
	} catch (e) {
		dispatch(editorSlice.actions.setLoadLevelState('error'));
	}
};

const loadFromLocalStorage = (): LevelThunk => (dispatch) => {
	try {
		const rawJson = window.localStorage[LOCALSTORAGE_KEY];

		if (rawJson) {
			try {
				const unknownLocalStorageData = JSON.parse(rawJson) as unknown;
				const localStorageData = convertLevelToLatestVersion(
					unknownLocalStorageData
				);

				if (localStorageData) {
					dispatch(
						editorSlice.actions.setLevelDataFromLoad(localStorageData.data)
					);
					dispatch(editorSlice.actions.setLevelName(localStorageData.name));
				} else {
					dispatch(editorSlice.actions.setLoadLevelState('legacy'));
				}
			} catch (e) {
				// eslint-disable-next-line no-console
				console.error('loadFromLocalStorage error', e);
				dispatch(editorSlice.actions.setLoadLevelState('error'));
			}
		}
	} catch (e) {
		// eslint-disable-next-line no-console
		console.error('loadFromLocalStorage error', e);
		dispatch(editorSlice.actions.setLoadLevelState('error'));
	}
};

const loadExampleLevel = (): LevelThunk => (dispatch) => {
	const exampleLevel = getExampleLevel();

	if (!exampleLevel) {
		throw new Error(
			'editorSlice#loadExampleLevel: called before example level file has been loaded'
		);
	}

	const converted = convertLevelToLatestVersion(exampleLevel);

	if (!converted) {
		dispatch(editorSlice.actions.setLoadLevelState('error'));
	} else {
		dispatch(editorSlice.actions.setLevelName(exampleLevel.name));
		dispatch(editorSlice.actions.setLevelDataFromLoad(converted.data));
	}
};

const loadBlankLevel = (): LevelThunk => (dispatch) => {
	dispatch(editorSlice.actions.eraseLevel());
};

const LOCALSTORAGE_KEY = 'smaghetti_editor';

const saveToLocalStorage = (): LevelThunk => (dispatch, getState) => {
	try {
		const editorState = getState().editor.present;

		const localStorageData: LevelData = {
			settings: editorState.settings,
			rooms: editorState.rooms.map((r) => {
				const { validEntityTypes, ...restOfRoom } = r;
				return restOfRoom;
			}),
		};

		const serializedLevelData = serialize(localStorageData);

		const dataToWrite: LocalStorageSerializedLevel = {
			name: editorState.name,
			version: CURRENT_VERSION,
			data: serializedLevelData,
		};

		try {
			const asJson = JSON.stringify(dataToWrite);
			window.localStorage[LOCALSTORAGE_KEY] = asJson;
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

const {
	setLevelName,
	setTimer,
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
	toggleManageLevelMode,
	addRoom,
	deleteRoom,
	roomSettingsChange,
	toggleGrid,
	toggleLayerLock,
	pushPan,
	popPan,
	resetOffset,
	addPaletteEntry,
	removePaletteEntry,
	setCurrentPaletteEntryByIndex,
	clearFocusedEntity,
	setEntitySettings,
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
		// ensurePlayerIsInView(draftState, { x: 0, y: 0 });
		ensureLevelIsInView(draftState);

		removeOutOfBoundsCells(draftState);
		removeOutOfBoundsEntities(draftState);
	});

	return nextState;
}

// @ts-ignore not sure why this ignore is needed...
const undoableReducer = undoable(cleanUpReducer, {
	filter: excludeAction([
		setLevelName.toString(),
		setTimer.toString(),
		setCurrentRoomIndex.toString(),
		mouseModeChanged.toString(),
		editorVisibleWindowChanged.toString(),
		scaleIncreased.toString(),
		scaleDecreased.toString(),
		toggleResizeMode.toString(),
		toggleManageLevelMode().toString(),
		resizeLevelComplete.toString(),
		pan.toString(),
		toggleGrid.toString(),
		toggleLayerLock.toString(),
		resetOffset.toString(),
		addPaletteEntry.toString(),
		removePaletteEntry.toString(),
		setCurrentPaletteEntryByIndex.toString(),
		clearFocusedEntity.toString(),
		selectDrag.toString(),
		'editor/savingLevel',
		'editor/saveLevel',
		'editor/saveLevelCopy',
		'editor/saveLevelError',
		'editor/loadLevel',
		'editor/loadingLevel',
		'editor/loadLevelError',
		'editor/setLevelDataFromLoad',
		'editor/loadFromLocalStorage',
		'editor/loadExampleLevel',
		'editor/loadBlankLevel',
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
	setTimer,
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
	toggleManageLevelMode,
	addRoom,
	deleteRoom,
	roomSettingsChange,
	toggleGrid,
	toggleLayerLock,
	pushPan,
	popPan,
	resetOffset,
	addPaletteEntry,
	removePaletteEntry,
	setCurrentPaletteEntryByIndex,
	clearFocusedEntity,
	setEntitySettings,
	saveLevel,
	saveLevelCopy,
	loadLevel,
	loadFromLocalStorage,
	loadExampleLevel,
	loadBlankLevel,
	saveToLocalStorage,
	eraseLevel,
	LOCALSTORAGE_KEY,
	SINGLE_BRICK_SO_PLAYER_DOESNT_FALL,
	getEntityTileBounds,
	pointIsInside,
};
