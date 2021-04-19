// this file was generated by
// /home/matt/dev/jumpclub/tilePipeline/generate.ts

import { EntityType } from '../entities/entityMap';

type TileHasEntityType = never;
type TileEntityType = never;
type EndCapType = 'start' | 'end' | 'both' | 'none';
type TileGroupType = 'none' | 'x' | 'y' | 'xy';
type TopperType = never;
type ToppedType = never;
type HasXEndCapType = never;
type HasYEndCapType = never;

const TILE_SIZE = 16;
const TILE_TYPE_COUNT = 2;

const TILE_TYPE_TO_TILE_ENTITY_TYPE: Record<
	TileHasEntityType,
	TileEntityType
> = {};

// TODO: really need this to go away
const TILE_TYPE_TO_SERIALIZE_ID_MAP: Partial<Record<EntityType, string>> = {
	Brick: 'Br',
	BuriedVegetable: 'Bu',
	IndestructibleBrick: 'In',
	Coin: '$',
	QuestionBlock: '?',
	PSwitch: 'Ps',
	TriangularBlock: 'Tb',
	MusicBlock: 'Mb',
	Muncher: 'Mu',
	Stalactite: 'St',
	HiddenBlock: 'Hb',
	WoodBlock: 'Wo',
	FortressBrick: 'Fb',
	Lava: 'Lv',
	FireBarBase: 'Fbb',
};

const TILE_SERIALIZED_ID_TO_TYPE_MAP: Record<
	string,
	EntityType
> = (function () {
	return Object.keys(TILE_TYPE_TO_SERIALIZE_ID_MAP).reduce<
		Record<string, EntityType>
	>((building, key) => {
		const val = TILE_TYPE_TO_SERIALIZE_ID_MAP[key as EntityType]!;
		building[val] = key as EntityType;
		return building;
	}, {});
})();

const TILE_TYPE_TO_GROUP_TYPE_MAP: Partial<
	Record<EntityType, TileGroupType>
> = {
	Brick: 'none',
	IndestructibleBrick: 'none',
	Coin: 'none',
	QuestionBlock: 'none',
	PSwitch: 'none',
	TriangularBlock: 'none',
	MusicBlock: 'none',
	Muncher: 'none',
	Stalactite: 'none',
	HiddenBlock: 'none',
	WoodBlock: 'none',
};

const TILE_TOPPER_TO_TOPPED_MAP: Record<TopperType, EntityType> = {};
const TILE_TOPPED_TO_TOPPER_MAP: Record<ToppedType, EntityType> = {};

const TILE_TYPE_TO_X_ENDCAPS_MAP: Record<HasXEndCapType, EndCapType> = {};

const TILE_TYPE_TO_Y_ENDCAPS_MAP: Record<HasYEndCapType, EndCapType> = {};

export {
	TILE_SIZE,
	TILE_TYPE_COUNT,
	TILE_TYPE_TO_SERIALIZE_ID_MAP,
	TILE_SERIALIZED_ID_TO_TYPE_MAP,
	TILE_TYPE_TO_GROUP_TYPE_MAP,
	TILE_TOPPER_TO_TOPPED_MAP,
	TILE_TOPPED_TO_TOPPER_MAP,
	TILE_TYPE_TO_X_ENDCAPS_MAP,
	TILE_TYPE_TO_Y_ENDCAPS_MAP,
	TILE_TYPE_TO_TILE_ENTITY_TYPE,
};

export type {
	TileHasEntityType,
	TileEntityType,
	EndCapType,
	TileGroupType,
	ToppedType,
	TopperType,
	HasXEndCapType,
	HasYEndCapType,
};
