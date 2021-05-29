import React from 'react';
import type { Entity } from './types';
import { TILE_SIZE } from '../tiles/constants';
import { ANY_OBJECT_SET } from './constants';

const Flurry: Entity = {
	paletteCategory: 'enemy',
	paletteInfo: {
		title: 'Flurry',
	},

	objectSets: ANY_OBJECT_SET,
	spriteGraphicSets: [-1, -1, -1, -1, -1, 0xf],
	layer: 'actor',
	editorType: 'entity',
	dimensions: 'none',
	objectId: 0xed,

	resource: {
		romOffset: 0x18c914,
		palette: [
			0x739c,
			0x7fff,
			0x0,
			0x11,
			0x295e,
			0x7610,
			0x7eb4,
			0x53bd,
			0x6bde,
			0x4920,
			0x6e2c,
			0x7fb4,
			0x29bd,
			0x467f,
			0x4f9f,
			0x63ff,
		],
		tiles: [
			[592, 593],
			[624, 625],
		],
	},

	toSpriteBinary(x, y) {
		return [0, this.objectId, x, y];
	},

	simpleRender(size) {
		return (
			<div
				className="Flurry-bg bg-cover"
				style={{ width: size, height: size }}
			/>
		);
	},

	render() {
		return this.simpleRender!(TILE_SIZE);
	},
};

export { Flurry };
