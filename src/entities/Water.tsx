import React from 'react';
import type { Entity } from './types';
import { TILE_SIZE } from '../tiles/constants';
import { ANY_SPRITE_GRAPHIC_SET } from './constants';
import { encodeObjectSets } from './util';

const Water: Entity = {
	// paletteCategory: 'controls',
	paletteInfo: {
		title: 'Water',
		description:
			'Adds water to a level going right and down from its location. Want a full on water level? This is what you want.',
		warning: 'Just found this entity, more research and experimenting needed',
	},

	objectSets: encodeObjectSets([[6, 6]]),
	spriteGraphicSets: ANY_SPRITE_GRAPHIC_SET,
	layer: 'stage',
	editorType: 'entity',
	dimensions: 'none',
	objectId: 0xd,
	emptyBank: 0,

	toObjectBinary(x, y) {
		return [0, y, x, this.objectId];
	},

	simpleRender(size) {
		const style = { width: size, height: size, fontSize: size * 0.25 };
		return (
			<div
				className="bg-blue-500 text-white font-bold grid place-items-center"
				style={style}
			>
				water
			</div>
		);
	},

	render(_showDetails, _settings, _osc, entity, room) {
		if (!entity || !room) {
			return this.simpleRender(TILE_SIZE);
		}

		const width = room.roomTileWidth - entity.x / TILE_SIZE;
		const height = room.roomTileHeight - entity.y / TILE_SIZE;

		const style = { width: width * TILE_SIZE, height: height * TILE_SIZE };

		return (
			<div style={style} className="relative">
				<div className="w-full h-full bg-blue-500 opacity-30" />
				<div
					className="absolute top-0 left-0"
					style={{ width: TILE_SIZE, height: TILE_SIZE }}
				>
					{this.simpleRender(TILE_SIZE)}
				</div>
			</div>
		);
	},
};

export { Water };
