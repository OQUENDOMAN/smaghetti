import type { Entity } from './types';
import { getBankParam1 } from './util';
import { TILE_SIZE } from '../tiles/constants';
import React from 'react';

/**
 * Does not work in current fortress/underground rooms
 */
const Cactus: Entity = {
	editorType: 'cell',
	dimensions: 'y',
	param1: 'width',
	objectId: 0x2e,
	emptyBank: 1,

	resource: {
		palette: [
			0x7f40,
			0x7fff,
			0x0,
			0x7629,
			0x7f30,
			0x7fd2,
			0x7ffb,
			0x2e39,
			0x42bd,
			0x535f,
			0x3708,
			0x3f6d,
			0x4bd1,
			0x5bf4,
			0x36df,
			0x6bf8,
		],
		romOffset: 0x16ea40,
		tiles: [
			[117, 118],
			[120, 121],
		],
	},

	toObjectBinary(x, y, w) {
		return [getBankParam1(1, w), y, x, this.objectId!];
	},

	simpleRender(mw, mh) {
		return (
			<div className="Cactus-bg bg-cover" style={{ width: mw, height: mh }} />
		);
	},

	render() {
		return this.simpleRender!(TILE_SIZE, TILE_SIZE);
	},
};

export { Cactus };
