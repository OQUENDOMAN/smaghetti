import type { Entity } from './types';
import { TILE_SIZE } from '../tiles/constants';
import React from 'react';
import { ANY_OBJECT_SET } from './constants';

const graphicSets = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

const CeilingBuzzyBeetle: Entity = {
	paletteCategory: 'enemy',
	paletteInfo: {
		subCategory: 'enemy-common',
		title: 'Buzzy Beetle - Ceiling',
		description: 'Drops down and attacks when Mario is below',
	},

	objectSets: ANY_OBJECT_SET,
	spriteGraphicSets: [
		graphicSets,
		graphicSets,
		-1,
		graphicSets,
		graphicSets,
		graphicSets,
	],
	objectId: 0x68,
	layer: 'actor',
	editorType: 'entity',
	dimensions: 'none',

	toSpriteBinary(x, y) {
		return [0, this.objectId, x, y];
	},

	simpleRender(size) {
		return (
			<div
				className="BuzzyBeetle-bg bg-cover"
				style={{ width: size, height: size, transform: 'scale(1, -1)' }}
			/>
		);
	},

	render() {
		return this.simpleRender(TILE_SIZE);
	},
};

export { CeilingBuzzyBeetle };
