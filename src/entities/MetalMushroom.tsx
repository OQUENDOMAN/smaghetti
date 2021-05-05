import type { Entity } from './types';
import { getBankParam1 } from './util';
import { TILE_SIZE } from '../tiles/constants';
import React from 'react';
import { ANY_SPRITE_GRAPHIC_SET } from './constants';

const MetalMushroom: Entity = {
	paletteCategory: 'terrain',
	paletteInfo: {
		title: 'Metal Mushroom',
		description: 'Pick up and build structures or throw them at enemies',
	},

	spriteGraphicSets: ANY_SPRITE_GRAPHIC_SET,
	editorType: 'cell',
	dimensions: 'xy',
	objectId: 0x51,
	emptyBank: 1,
	param1: 'width',
	param2: 'height',

	resource: {
		palette: [
			0x23df,
			0x7fff,
			0x0,
			0x4e71,
			0x5ef5,
			0x6f79,
			0x7bdd,
			0x13,
			0x19,
			0x1f,
			0x112,
			0x5a1f,
			0x6ebf,
			0x7f9f,
			0x579f,
			0x6fff,
		],
		romOffset: 0x20e4f0,
		tiles: [
			[70, 71],
			[86, 87],
		],
	},

	toObjectBinary(x, y, w, h): number[] {
		return [getBankParam1(1, w), y, x, this.objectId!, h];
	},

	simpleRender(mw, mh) {
		return (
			<div
				className="MetalMushroom-bg bg-cover"
				style={{ width: mw, height: mh }}
			/>
		);
	},

	render() {
		return this.simpleRender!(TILE_SIZE, TILE_SIZE);
	},
};

export { MetalMushroom };
