import type { Entity } from './types';
import { getBankParam1 } from './util';
import { ROOM_TYPE_SETTINGS } from '../levelData/constants';

const FortressSpike: Entity = {
	objectSets: [ROOM_TYPE_SETTINGS.fortress.objectSet],
	graphicSets: [ROOM_TYPE_SETTINGS.fortress.objectGraphicSet],
	type: 'FortressSpike',
	editorType: 'tile',
	gameType: 'object',
	dimensions: 'x',
	param1: 'width',
	objectId: 0xb,
	emptyBank: 1,
	romOffset: 0x167674,
	palette: [
		0x7f96,
		0x7fff,
		0x0,
		0x65a3,
		0x7a8b,
		0x7f6e,
		0x7fd6,
		0x1594,
		0x2e39,
		0x42bd,
		0x11,
		0x16,
		0x1a,
		0xdbe,
		0x123f,
		0x2bf,
	],
	tiles: [
		[76, 76],
		[74, 74],
	],

	toBinary(x, y, w) {
		return [getBankParam1(1, w), y, x, this.objectId!];
	},
};

export { FortressSpike };
